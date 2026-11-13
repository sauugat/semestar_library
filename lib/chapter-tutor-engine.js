'use strict';

/**
 * KAIE Chapter Tutor & Continuous Chapter Reader Engine (Phase 3 Stage 2: Unified Chapter Tutor)
 */

const path = require('path');
const { ensureRagSchema } = require('./rag-schema');
const {
  CONCEPT_TAXONOMY,
  normalizeText,
  parseSemesterNumber
} = require('./academic-document-understanding');
const {
  resolveCourseAndChapter,
  computeTopicSimilarity
} = require('./study-partner-reconciler');
const { canReadResource } = require('./kyana-access');
const { retrieveAcademicEvidence } = require('./hybrid-rag-engine');
const {
  searchPyqQuestions,
  getTopicPyqAnalytics
} = require('./pyq-intelligence');
const {
  planAdaptivePresentation,
  buildAdaptivePresentationPrompt,
  buildAdaptiveEducationalFallback,
  sanitizeAdaptiveResponse
} = require('./adaptive-presentation-engine');
const {
  formatPageProvenanceLabel,
  detectAcademicEvidenceConflicts
} = require('./academic-conflict-detector');
const {
  retrieveChapterVisualAssets,
  hasDiagramDescriptions
} = require('./chapter-tutor-visuals');

const DEFAULT_MAX_CONTEXT_TOKENS = 1600;
const CHARS_PER_TOKEN_ESTIMATE = 4;

// Built-in academic prerequisite relationships within the same subject
const ACADEMIC_PREREQUISITE_MAP = [
  {
    triggerTerms: ['function', 'functions', 'closure', 'closures', 'callback', 'callbacks', 'arrow function', 'hoisting'],
    prerequisiteTerms: ['variable', 'variables', 'scope', 'let', 'const', 'var', 'data types', 'lexical scope'],
    relationship: 'prerequisite_for_functions'
  },
  {
    triggerTerms: ['tcp', 'udp', 'transport layer', 'port number', 'socket', 'three way handshake', 'congestion control', 'flow control'],
    prerequisiteTerms: ['ip', 'ip address', 'ip addressing', 'ipv4', 'subnet', 'subnetting', 'packet', 'network layer', 'routing'],
    relationship: 'prerequisite_for_transport_layer'
  },
  {
    triggerTerms: ['binary tree', 'bst', 'binary search tree', 'avl tree', 'tree traversal', 'inorder', 'preorder', 'postorder', 'quicksort', 'mergesort', 'backtracking', 'dynamic programming'],
    prerequisiteTerms: ['recursion', 'recursive', 'base case', 'call stack', 'pointer', 'pointers', 'node'],
    relationship: 'prerequisite_for_trees_and_divide_conquer'
  },
  {
    triggerTerms: ['linked list', 'doubly linked list', 'circular linked list', 'dynamic memory'],
    prerequisiteTerms: ['pointer', 'pointers', 'struct', 'structure', 'malloc', 'memory address'],
    relationship: 'prerequisite_for_linked_lists'
  },
  {
    triggerTerms: ['predicate logic', 'quantifier', 'quantifiers', 'nested quantifier', 'universal quantifier', 'existential quantifier', 'inference rules'],
    prerequisiteTerms: ['proposition', 'propositional logic', 'truth table', 'logical equivalence', 'tautology', 'implication'],
    relationship: 'prerequisite_for_predicate_logic'
  },
  {
    triggerTerms: ['bcnf', 'third normal form', '3nf', '2nf', '1nf', 'normalization', 'lossless join'],
    prerequisiteTerms: ['functional dependency', 'candidate key', 'primary key', 'super key', 'closure of attributes', 'relational model'],
    relationship: 'prerequisite_for_normalization'
  },
  {
    triggerTerms: ['inheritance', 'polymorphism', 'method overriding', 'abstract class', 'interface', 'virtual function'],
    prerequisiteTerms: ['class', 'object', 'constructor', 'encapsulation', 'access modifier', 'methods'],
    relationship: 'prerequisite_for_oop_inheritance'
  },
  {
    triggerTerms: ['deadlock avoidance', 'banker algorithm', 'deadlock detection', 'process synchronization', 'semaphore', 'mutex'],
    prerequisiteTerms: ['process', 'thread', 'critical section', 'race condition', 'cpu scheduling', 'resource allocation'],
    relationship: 'prerequisite_for_synchronization_deadlock'
  }
];

function extractUnitNumberFromChapter(chapterTitle, explicitUnit) {
  const parsed = Number.parseInt(explicitUnit, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 50) return parsed;
  const m = String(chapterTitle || '').match(/\b(?:unit|chapter|ch|module)\s*[-:.]?\s*(\d{1,2})\b/i);
  if (m) {
    const u = Number.parseInt(m[1], 10);
    if (Number.isInteger(u) && u > 0 && u <= 50) return u;
  }
  return null;
}

function getFileExtension(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function classifyReaderFileType(fileRow = {}) {
  const name = fileRow.originalName || fileRow.original_name || fileRow.title || '';
  const preview = fileRow.previewName || fileRow.preview_name || '';
  const ext = getFileExtension(name);
  if (ext === '.pdf' || String(preview).toLowerCase().endsWith('.pdf')) return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image';
  if (['.ppt', '.pptx'].includes(ext)) return 'pptx';
  if (['.doc', '.docx'].includes(ext)) return 'docx';
  if (['.txt', '.md', '.c', '.cpp', '.py', '.java', '.js', '.html', '.css', '.sql', '.php'].includes(ext)) return 'text';
  return 'document';
}

function sortChapterFilesNaturally(rows = []) {
  return [...rows].sort((a, b) => {
    const aOrder = Number(a.sort_order ?? a.sortOrder ?? 0) || 0;
    const bOrder = Number(b.sort_order ?? b.sortOrder ?? 0) || 0;
    if (aOrder > 0 && bOrder > 0 && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder > 0 && bOrder <= 0) return -1;
    if (bOrder > 0 && aOrder <= 0) return 1;

    const aLabel = String(a.title || a.originalName || a.original_name || '').trim();
    const bLabel = String(b.title || b.originalName || b.original_name || '').trim();
    const cmp = aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

function estimateTokens(text = '') {
  const len = String(text || '').length;
  return Math.max(1, Math.ceil(len / CHARS_PER_TOKEN_ESTIMATE));
}

function isSameAcademicSubject(subA, codeA, subB, codeB) {
  const normCodeA = normalizeText(codeA || '');
  const normCodeB = normalizeText(codeB || '');
  if (normCodeA && normCodeB && normCodeA !== 'course' && normCodeB !== 'course' && normCodeA === normCodeB) {
    return true;
  }
  const normA = normalizeText(subA || '');
  const normB = normalizeText(subB || '');
  if (!normA || !normB) return false;
  if (normA === normB || normA.includes(normB) || normB.includes(normA)) return true;
  return computeTopicSimilarity(normA, normB) >= 0.72;
}

/**
 * Builds the complete Chapter Reader & AI Context Bundle for a chapter in the Library.
 */
async function getChapterReaderBundle(db, options = {}) {
  if (!db) throw new Error('Database instance is required');
  await ensureRagSchema(db);

  const rawSubject = String(options.subject || '').trim();
  const rawChapter = String(options.chapterTitle || options.chapter || '').trim();
  const unitNumber = extractUnitNumberFromChapter(rawChapter, options.unitNumber);
  const requestedFileIds = Array.isArray(options.fileIds)
    ? options.fileIds.map((id) => Number.parseInt(id, 10)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const hasAcademicContextProp = Object.prototype.hasOwnProperty.call(options, 'academicContext');
  const rawAcademicContext = options.academicContext;

  if (hasAcademicContextProp) {
    if (!rawAcademicContext || rawAcademicContext.dbError) {
      const err = new Error('Academic authorization context unavailable.');
      err.status = 503;
      throw err;
    }
    if (rawAcademicContext.authenticated === false || rawAcademicContext.role === 'anonymous') {
      const err = new Error('Authentication required to access chapter reader bundle.');
      err.status = 403;
      throw err;
    }
  }
  const academicContext = rawAcademicContext
    ? (rawAcademicContext.authenticated !== undefined ? rawAcademicContext : { ...rawAcademicContext, authenticated: true })
    : null;

  const resolved = resolveCourseAndChapter(
    rawSubject || 'Web Technology I',
    rawChapter || (unitNumber ? `Unit ${unitNumber}` : 'Unit 1'),
    options.semesterNo
  );

  const course = resolved?.course || {
    title: rawSubject || 'Course',
    code: options.subjectCode || 'COURSE',
    semesterNo: parseSemesterNumber(options.semesterNo) || 1,
    units: []
  };

  const effectiveUnitNumber = unitNumber || resolved?.unitNumber || 1;
  const matchedUnit = (course.units || []).find((u) => Number(u.unitNumber) === Number(effectiveUnitNumber))
    || (course.units || [])[0]
    || null;

  const syllabusTopics = matchedUnit && Array.isArray(matchedUnit.topics) && matchedUnit.topics.length > 0
    ? matchedUnit.topics.map((t) => (typeof t === 'string' ? t : t.title)).filter(Boolean)
    : [];

  const explicitPageMatch = String(options.userMessage || '').match(/\b(?:page|panna|slide)\s*#?\s*(\d+)\b/i);
  const targetExplicitPage = explicitPageMatch ? Number.parseInt(explicitPageMatch[1], 10) : null;

  let fileRows = [];
  if (requestedFileIds.length > 0) {
    const placeholders = requestedFileIds.map(() => '?').join(',');
    const fetched = await db.all(
      `SELECT *
       FROM files
       WHERE id IN (${placeholders})`,
      ...requestedFileIds
    ).catch(() => []);
    const byId = new Map((fetched || []).map((f) => [Number(f.id), f]));
    fileRows = requestedFileIds.map((id) => byId.get(id)).filter(Boolean);
  } else if (rawSubject) {
    const allSubjectFiles = await db.all(
      `SELECT *
       FROM files
       WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))
       ORDER BY CASE WHEN COALESCE(sort_order, 0) > 0 THEN 0 ELSE 1 END ASC, COALESCE(sort_order, 0) ASC, id ASC`,
      rawSubject
    ).catch(() => []);

    fileRows = (allSubjectFiles || []).filter((f) => {
      const ch = String(f.chapter || '').toLowerCase().trim();
      const fUnit = Number(f.unit_number ?? f.unitNumber);
      if (rawChapter && ch === rawChapter.toLowerCase().trim()) return true;
      if (effectiveUnitNumber && fUnit === Number(effectiveUnitNumber)) return true;
      if (effectiveUnitNumber && (ch.includes(`unit ${effectiveUnitNumber}`) || ch.startsWith(`unit ${effectiveUnitNumber}:`))) return true;
      if (matchedUnit?.title && matchedUnit.title.length > 3 && ch.includes(matchedUnit.title.toLowerCase())) return true;
      return false;
    });
  }

  const allowedSubjects = new Set(
    [rawSubject, course.title, course.code, options.subjectCode]
      .map((s) => normalizeText(s || ''))
      .filter(Boolean)
  );

  fileRows = (fileRows || []).filter((f) => {
    if (!f || f.deleted_at || f.hidden_at || ['removed', 'hidden'].includes(f.moderation_status)) {
      return false;
    }
    if (allowedSubjects.size > 0 && f.subject) {
      const fSubNorm = normalizeText(f.subject);
      const fCodeNorm = normalizeText(f.subject_code || f.subjectCode || '');
      const subjectMatch = Array.from(allowedSubjects).some(
        (as) => fSubNorm === as || fSubNorm.includes(as) || as.includes(fSubNorm) || (fCodeNorm && fCodeNorm === as) || computeTopicSimilarity(fSubNorm, as) >= 0.72
      );
      if (!subjectMatch) return false;
    }
    if (academicContext && typeof canReadResource === 'function') {
      return canReadResource(academicContext, f, 'note', { allowCrossSemester: false });
    }
    return true;
  });

  fileRows = sortChapterFilesNaturally(fileRows);

  const chapterFiles = [];
  for (let i = 0; i < fileRows.length; i++) {
    const f = fileRows[i];
    const fileIdStr = String(f.id);
    const [pages, items, chunks] = await Promise.all([
      db.all(
        `SELECT page_number, cleaned_text, raw_text, has_OCR,
                diagrams_json, equations_json, tables_json, metadata_json
         FROM document_pages
         WHERE ${db.isPostgres ? 'CAST(file_id AS TEXT) = ?' : '(CAST(file_id AS TEXT) = ? OR CAST(file_id AS INTEGER) = ?)'}
         ORDER BY page_number ASC`,
        ...(db.isPostgres ? [fileIdStr] : [fileIdStr, Number(f.id)])
      ).catch(() =>
        db.all(
          `SELECT page_number, cleaned_text, raw_text, has_OCR
           FROM document_pages
           WHERE ${db.isPostgres ? 'CAST(file_id AS TEXT) = ?' : '(CAST(file_id AS TEXT) = ? OR CAST(file_id AS INTEGER) = ?)'}
           ORDER BY page_number ASC`,
          ...(db.isPostgres ? [fileIdStr] : [fileIdStr, Number(f.id)])
        ).catch(() => [])
      ),
      db.all(
        `SELECT id, item_type, title, topic, concept_key, content_text, page_start, page_end
         FROM academic_extracted_items
         WHERE ${db.isPostgres ? 'CAST(file_id AS TEXT) = ?' : '(CAST(file_id AS TEXT) = ? OR CAST(file_id AS INTEGER) = ?)'}
         ORDER BY page_start ASC, id ASC`,
        ...(db.isPostgres ? [fileIdStr] : [fileIdStr, Number(f.id)])
      ).catch(() => []),
      db.all(
        `SELECT id, chunk_index, page_start, page_end, section_heading, clean_content
         FROM document_chunks
         WHERE ${db.isPostgres ? 'CAST(file_id AS TEXT) = ?' : '(CAST(file_id AS TEXT) = ? OR CAST(file_id AS INTEGER) = ?)'}
           AND COALESCE(chunk_level, 'child') = 'child'
         ORDER BY page_start ASC, chunk_index ASC`,
        ...(db.isPostgres ? [fileIdStr] : [fileIdStr, Number(f.id)])
      ).catch(() => [])
    ]);

    const normalizedPages = (pages || []).map((p) => {
      let pageType = p.page_type || p.pageType || 'text';
      let latexPresent = Boolean(p.latex_present || p.latexPresent);
      let figureDescription = p.figure_description || p.figureDescription || null;
      let figureTitle = p.figure_title || p.figureTitle || null;
      let pageImagePath = p.page_image_path || p.pageImagePath || null;

      // Parse diagrams_json if present
      let diagrams = [];
      if (Array.isArray(p.diagrams)) {
        diagrams = p.diagrams;
      } else if (p.diagrams_json && typeof p.diagrams_json === 'string') {
        try { diagrams = JSON.parse(p.diagrams_json); } catch (_) {}
      }

      if (diagrams.length > 0) {
        pageType = 'diagram';
        const firstDiag = diagrams[0];
        if (!figureTitle) figureTitle = typeof firstDiag === 'object' ? (firstDiag.title || 'Diagram') : 'Diagram';
        if (!figureDescription) figureDescription = typeof firstDiag === 'string' ? firstDiag : (firstDiag.description || '');
      }

      // Parse equations_json if present
      let equations = [];
      if (Array.isArray(p.equations)) {
        equations = p.equations;
      } else if (p.equations_json && typeof p.equations_json === 'string') {
        try { equations = JSON.parse(p.equations_json); } catch (_) {}
      }

      if (equations.length > 0) {
        latexPresent = true;
        if (pageType === 'text') pageType = 'math';
      }

      // Parse metadata_json if present
      if (p.metadata_json && typeof p.metadata_json === 'string') {
        try {
          const meta = JSON.parse(p.metadata_json);
          if (!pageImagePath && meta.page_image_path) pageImagePath = meta.page_image_path;
          if (!figureDescription && meta.figure_description) figureDescription = meta.figure_description;
          if (meta.latex_present) latexPresent = true;
          if (meta.page_type) pageType = meta.page_type;
        } catch (_) {}
      }

      return {
        pageNumber: Number(p.page_number ?? p.pageNumber ?? 1),
        text: String(p.cleaned_text || p.cleanedText || p.raw_text || p.rawText || p.text || '').trim(),
        hasOcr: Boolean(p.has_OCR ?? p.hasOcr ?? p.ocr_applied),
        pageType,
        latexPresent,
        figureDescription,
        figureTitle,
        pageImagePath,
        diagrams,
        equations
      };
    }).filter((p) => p.text.length > 0 || p.figureDescription || p.pageType === 'diagram' || p.pageType === 'figure' || p.pageImagePath);

    if (normalizedPages.length === 0 && Array.isArray(chunks) && chunks.length > 0) {
      const byPage = new Map();
      for (const ch of chunks) {
        const pNum = Number(ch.page_start ?? ch.pageStart ?? 1);
        if (!byPage.has(pNum)) byPage.set(pNum, []);
        byPage.get(pNum).push(String(ch.clean_content || ch.cleanContent || '').trim());
      }
      for (const [pNum, texts] of Array.from(byPage.entries()).sort((a, b) => a[0] - b[0])) {
        const joined = texts.filter(Boolean).join('\n\n');
        if (joined) normalizedPages.push({
          pageNumber: pNum,
          text: joined,
          hasOcr: false,
          pageType: 'text',
          latexPresent: false,
          figureDescription: null,
          figureTitle: null,
          pageImagePath: null,
          diagrams: [],
          equations: []
        });
      }
    }

    const isPdf = classifyReaderFileType(f) === 'pdf' || String(f.storedName || f.storedname || f.originalName || '').toLowerCase().endsWith('.pdf');
    if (isPdf && (normalizedPages.length <= 1 || (targetExplicitPage && !normalizedPages.some((p) => p.pageNumber === targetExplicitPage)))) {
      try {
        const { resolveDocumentBuffer, extractPdfDocument } = require('./document-ingestion');
        const pdfBuf = await resolveDocumentBuffer(db, f);
        if (pdfBuf && Buffer.isBuffer(pdfBuf)) {
          const extracted = await extractPdfDocument(pdfBuf, f);
          if (extracted && Array.isArray(extracted.pages) && extracted.pages.length > normalizedPages.length) {
            normalizedPages.length = 0;
            for (const ep of extracted.pages) {
              const pText = String(ep.cleaned_text || ep.raw_text || '').trim();
              normalizedPages.push({
                pageNumber: Number(ep.page_number || ep.pageNumber || 1),
                text: pText,
                hasOcr: Boolean(ep.ocr_applied),
                pageType: ep.page_type || (ep.diagrams && ep.diagrams.length ? 'diagram' : (ep.equations && ep.equations.length ? 'math' : 'text')),
                latexPresent: Boolean(ep.latex_present || (ep.equations && ep.equations.length)),
                figureDescription: ep.figure_description || (ep.diagrams && ep.diagrams[0]?.description) || null,
                figureTitle: ep.figure_title || (ep.diagrams && ep.diagrams[0]?.title) || null,
                pageImagePath: ep.page_image_path || null,
                diagrams: ep.diagrams || [],
                equations: ep.equations || []
              });
            }
          }
        }
      } catch (_) {}
    }

    const readerType = classifyReaderFileType(f);
    chapterFiles.push({
      orderIndex: i + 1,
      id: Number(f.id),
      storedName: f.storedName || f.stored_name || '',
      title: f.title || f.originalName || `Note ${i + 1}`,
      originalName: f.originalName || f.original_name || '',
      chapter: f.chapter || rawChapter || null,
      unitNumber: Number(f.unit_number ?? f.unitNumber ?? effectiveUnitNumber) || effectiveUnitNumber,
      readerType,
      mimeType: f.mimeType || f.mime_type || f.mimetype || '',
      viewUrl: `/api/files/${f.id}/view`,
      downloadUrl: `/api/files/${f.id}/download`,
      sizeBytes: Number(f.sizeBytes || f.size_bytes || 0),
      resourceCategory: f.resource_category || f.resourceCategory || 'notes',
      pageNumber: Number(f.pageNumber ?? f.page_number ?? f.pageStart ?? f.page_start ?? (normalizedPages[0]?.pageNumber || 1)),
      pageCount: normalizedPages.length,
      pages: normalizedPages,
      extractedItemsCount: (items || []).length,
      extractedItems: (items || []).slice(0, 30).map((it) => ({
        id: it.id,
        itemType: it.item_type || it.itemType,
        title: it.title || it.topic,
        contentText: it.content_text || it.contentText,
        pageStart: Number(it.page_start ?? it.pageStart ?? 1),
        pageEnd: Number(it.page_end ?? it.pageEnd ?? 1),
        structuredJson: it.structured_json || it.structuredJson || null
      }))
    });
  }

  const explicitSemNo = parseSemesterNumber(options.semesterNo);

  return {
    subject: course.title || rawSubject || 'Course',
    rawSubject: rawSubject || course.title || 'Course',
    subjectCode: options.subjectCode || course.code || 'COURSE',
    semesterNo: explicitSemNo || course.semesterNo || 1,
    unitNumber: matchedUnit ? matchedUnit.unitNumber : effectiveUnitNumber,
    chapterTitle: rawChapter || (matchedUnit ? `Unit ${matchedUnit.unitNumber}: ${matchedUnit.title}` : 'Chapter Notes'),
    unitTitle: matchedUnit ? matchedUnit.title : rawChapter,
    teachingHours: matchedUnit ? (matchedUnit.teachingHours || 0) : 0,
    syllabusTopics,
    courseUnits: Array.isArray(course.units) ? course.units : [],
    totalFiles: chapterFiles.length,
    files: chapterFiles
  };
}

/**
 * Detects prerequisite concepts or other-chapter concepts within the SAME subject
 * that are referenced or required by the student's question.
 */
function detectSameSubjectPrerequisiteTargets(queryText = '', syllabusTopics = [], courseUnits = [], activeUnitNumber = 1, activeChapterTitle = '') {
  const normQuery = normalizeText(queryText);
  if (!normQuery) return [];

  const activeSylNorms = (syllabusTopics || []).map(normalizeText).filter(Boolean);
  const normActiveChap = normalizeText(activeChapterTitle || '');
  const combinedActiveContext = `${normActiveChap} ${activeSylNorms.join(' ')} ${normQuery}`;

  const targets = [];
  const seenTerms = new Set();

  const addTarget = (term, sourceReason, unitNumber = null, unitTitle = null) => {
    const clean = normalizeText(term);
    if (!clean || clean.length < 2 || seenTerms.has(clean)) return;
    seenTerms.add(clean);
    targets.push({
      concept: term,
      normalizedConcept: clean,
      sourceReason,
      unitNumber,
      unitTitle
    });
  };

  for (const rule of ACADEMIC_PREREQUISITE_MAP) {
    const triggerActive = rule.triggerTerms.some((t) => combinedActiveContext.includes(normalizeText(t)));
    const prereqMentionedInQuery = rule.prerequisiteTerms.filter((p) => {
      const np = normalizeText(p);
      return new RegExp(`(?:^|\\b)${np.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'i').test(normQuery);
    });

    if (prereqMentionedInQuery.length > 0) {
      for (const pm of prereqMentionedInQuery) {
        addTarget(pm, rule.relationship);
      }
    } else if (triggerActive && /\b(?:prerequisite|before|underlying|foundation|how\s+does|why\s+does|work\s+with|use|uses|using|depend|depends)\b/i.test(queryText)) {
      for (const pt of rule.prerequisiteTerms.slice(0, 3)) {
        const npt = normalizeText(pt);
        const alreadyInActiveSyllabus = activeSylNorms.some((s) => s.includes(npt));
        if (!alreadyInActiveSyllabus) {
          addTarget(pt, rule.relationship);
        }
      }
    }
  }

  for (const unit of courseUnits || []) {
    if (Number(unit.unitNumber) === Number(activeUnitNumber)) continue;
    const isEarlierUnit = Number(unit.unitNumber) < Number(activeUnitNumber);
    const unitTitleNorm = normalizeText(unit.title || '');
    if (unitTitleNorm.length >= 4 && normQuery.includes(unitTitleNorm)) {
      const inActive = activeSylNorms.some((s) => s.includes(unitTitleNorm));
      if (!inActive) {
        addTarget(unit.title, isEarlierUnit ? 'earlier_syllabus_unit' : 'related_syllabus_unit', unit.unitNumber, unit.title);
      }
    }
    for (const topic of unit.topics || []) {
      const topicStr = typeof topic === 'string' ? topic : topic.title;
      const normT = normalizeText(topicStr);
      if (!normT || normT.length < 3) continue;
      if (normQuery.includes(normT)) {
        const inActive = activeSylNorms.some((s) => s.includes(normT));
        if (!inActive) {
          addTarget(topicStr, isEarlierUnit ? 'earlier_syllabus_topic' : 'related_syllabus_topic', unit.unitNumber, unit.title);
        }
      }
    }
  }

  return targets.slice(0, 6);
}

/**
 * Stage 1 of the Chapter Tutor Pipeline:
 * Analyzes the student's message + conversation history + syllabus/course context.
 */
function analyzeChapterStudentQuestion(message = '', history = [], syllabusTopics = [], courseUnits = [], activeUnitNumber = 1, activeChapterTitle = '') {
  const cleanMsg = String(message || '').trim();
  const lower = cleanMsg.toLowerCase();

  const isExplicitChapterTeachRequest =
    /\b(?:teach\s+me\s+(?:this|the)\s+(?:chapter|unit|topic|lesson)|start\s+teaching(?:\s+this\s+chapter)?|teach\s+(?:this|full|whole)\s+(?:chapter|unit)(?:\s+step\s+by\s+step)?|teach\s+me\s+step\s+by\s+step|teach\s+me\s+from\s+(?:the\s+)?(?:beginning|start|scratch)|yo\s+(?:chapter|unit)\s+(?:padhaideu|padhau|sikaideu|bujhaideu)|chapter\s+suru\s+gara)\b/i.test(cleanMsg) ||
    /^(?:teach\s+me|start\s+lesson|teach\s+this\s+unit|step\s+by\s+step\s+teach)[.!?]*$/i.test(cleanMsg);

  const isConfusionFollowUp =
    /\b(?:i\s+(?:don'?t|do\s+not|didn'?t)\s+understand|confused|still\s+not\s+clear|not\s+clear|explain\s+(?:again|more|simply|in\s+simple\s+words|better)|simplify|bujhina|bujhena|ali\s+sajilo|feri\s+bujhaideu|ramrari\s+bujhaideu|kasto\s+ho\s+yo)\b/i.test(cleanMsg);

  const isExampleFollowUp =
    /\b(?:give\s+(?:me\s+)?(?:an?\s+|another\s+|more\s+|some\s+)?(?:(?:\w+\s+){0,2})?examples?|show\s+(?:me\s+)?(?:an?\s+)?(?:(?:\w+\s+){0,2})?(?:example|code|demo|program)|with\s+(?:an?\s+)?example|real\s+(?:life|world)\s+example|udaharan|example\s+deu|code\s+deu)\b/i.test(cleanMsg);

  const isPyqSolveRequest =
    /\b(?:solve|solution|work\s+out|answer\s+(?:this|the)?|provide\s+(?:a\s+)?solution|step[\s-]by[\s-]step\s+solution|how\s+to\s+solve)\b/i.test(cleanMsg) &&
    (/\b(?:q(?:uestion)?\.?\s*#?\s*\d+|pyqs?|past\s+questions?|board\s+questions?|exam\s+questions?|pre[\s-]board|final\s+exam|\d{4}\s+(?:fall|spring|board))\b/i.test(cleanMsg) ||
     /\b(?:solve\s+(?:question|q\.?|this\s+pyq|this\s+past\s+question))\b/i.test(cleanMsg));

  let targetQuestionNumber = null;
  const qNumMatch = cleanMsg.match(/\b(?:question|q)\.?\s*#?\s*(\d+(?:\s*\([a-z]\)|[a-z])?)\b/i);
  if (qNumMatch) {
    targetQuestionNumber = qNumMatch[1].replace(/\s+/g, '');
  }

  let targetExamYear = null;
  const yearMatch = cleanMsg.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    targetExamYear = yearMatch[1];
  }

  let targetExamType = null;
  const examTypeMatch = cleanMsg.match(/\b(pre[\s-]board(?:\s+set\s+[a-z])?|board(?:\s+exam)?|fall|spring|final\s+exam|set\s+[a-z])\b/i);
  if (examTypeMatch) {
    targetExamType = examTypeMatch[1].trim();
  }

  const isQuestionPracticeRequest =
    isPyqSolveRequest ||
    /\b(?:model\s+questions?|exam\s+questions?|important\s+questions?|practice\s+questions?|pyqs?|past\s+(?:year\s+)?questions?|previous[\s-]year\s+questions?|board\s+questions?|repeated\s+questions?|appeared\s+repeatedly|what\s+should\s+i\s+prepare\s+for\s+(?:the\s+)?exam|important\s+for\s+(?:this\s+chapter|the\s+exam)|ask\s+me\s+a?\s*questions?|quiz\s+me|test\s+me)\b/i.test(cleanMsg);

  const isPyqDiscoveryRequest = isQuestionPracticeRequest && !isPyqSolveRequest;

  const isRepeatedPyqRequest =
    /\b(?:repeated(?:ly)?|most\s+asked|frequent(?:ly)?\s+asked|appeared\s+repeatedly|high\s+weightage|important\s+for\s+(?:this\s+chapter|the\s+exam)|what\s+should\s+i\s+prepare)\b/i.test(cleanMsg);

  const isSummaryRequest =
    /\b(?:summarize|summary|overview|key\s+points?|main\s+topics?|what\s+is\s+in\s+this\s+chapter|all\s+notes\s+summary)\b/i.test(cleanMsg);

  const isShortFollowUp =
    isConfusionFollowUp ||
    isExampleFollowUp ||
    /^(?:why|how|what\s+about\s+it|and\s+then|what\s+does\s+that\s+mean|elaborate|more\s+details?|tell\s+me\s+more)[?.!]*$/i.test(cleanMsg);

  let priorTopic = '';
  let lastAssistantMessage = '';
  let lastUserQuestion = '';

  const reversedHistory = [...(Array.isArray(history) ? history : [])].reverse();
  for (const turn of reversedHistory) {
    if (!turn || !turn.content) continue;
    const text = String(turn.content).trim();
    if (!lastAssistantMessage && turn.role === 'assistant') {
      lastAssistantMessage = text;
      const boldMatch = text.match(/\*\*([^*]{3,70})\*\*/);
      if (boldMatch) priorTopic = boldMatch[1].trim();
    } else if (!lastUserQuestion && turn.role === 'user' && text.toLowerCase() !== lower) {
      const prevIsGenericFollowUp = /\b(?:don'?t\s+understand|give\s+me\s+an?\s+example|bujhina|explain\s+again|simplify)\b/i.test(text);
      if (!prevIsGenericFollowUp) {
        lastUserQuestion = text;
        if (!priorTopic) priorTopic = text;
      }
    }
  }

  let resolvedTopicQuery = cleanMsg;
  if (isShortFollowUp && (lastUserQuestion || priorTopic)) {
    const specificTermsInCurrent = cleanMsg
      .replace(/\b(?:i\s+(?:don'?t|do\s+not|didn'?t)\s+understand|give\s+me\s+(?:an?\s+|another\s+|more\s+)?(?:practical\s+|simple\s+|real\s+|code\s+)?examples?(?:\s+of)?|can\s+you\s+explain|explain\s+again|please|now|can\s+you|show\s+me|bujhina|feri|[?,!.])\b/gi, '')
      .trim();
    resolvedTopicQuery = specificTermsInCurrent.length >= 4
      ? `${specificTermsInCurrent} ${priorTopic || lastUserQuestion}`.trim()
      : (lastUserQuestion || priorTopic || cleanMsg);
  }

  let pyqTopicFilter = '';
  if (isQuestionPracticeRequest) {
    const cleanedPyqTopic = resolvedTopicQuery
      .replace(/\b(?:solve|solution|work\s+out|answer|step[\s-]by[\s-]step|provide|for|from|on|in|about|what|show|give|me|are)\b/gi, ' ')
      .replace(/\b(?:question|q)\.?\s*#?\s*\d+(?:\s*\([a-z]\)|[a-z])?\b/gi, ' ')
      .replace(/\b(20\d{2}|pre[\s-]board|board|final\s+exam|fall|spring|set\s+[a-z])\b/gi, ' ')
      .replace(/\b(?:what\s+questions?\s+are\s+important\s+for|show\s+(?:me\s+)?(?:previous[\s-]year|past|exam|important|model)\s+questions?\s+(?:from|on|about|for)|give\s+(?:me\s+)?questions?\s+that\s+have\s+appeared\s+repeatedly(?:\s+(?:in|on|from))?|what\s+should\s+i\s+prepare\s+for\s+(?:the\s+)?exam(?:\s+(?:in|on|from))?|previous[\s-]year\s+questions?|important\s+questions?|exam\s+questions?|model\s+questions?|practice\s+questions?|pyqs?|this\s+chapter|this\s+unit|this\s+topic|the\s+exam)\b/gi, ' ')
      .replace(/[?!.,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedPyqTopic.length >= 3) {
      pyqTopicFilter = cleanedPyqTopic;
    }
  }

  let matchedSyllabusTopic = null;
  let bestSylScore = 0;
  const normQuery = normalizeText(pyqTopicFilter || resolvedTopicQuery);
  for (const st of syllabusTopics || []) {
    const normSt = normalizeText(st);
    if (!normSt) continue;
    let score = computeTopicSimilarity(normSt, normQuery);
    if (normQuery.includes(normSt) || normSt.includes(normQuery)) {
      score = Math.max(score, 0.85);
    }
    if (score > bestSylScore) {
      bestSylScore = score;
      matchedSyllabusTopic = st;
    }
  }

  const prerequisiteTargets = detectSameSubjectPrerequisiteTargets(
    resolvedTopicQuery,
    syllabusTopics,
    courseUnits,
    activeUnitNumber,
    activeChapterTitle
  );

  return {
    originalQuestion: cleanMsg,
    resolvedTopicQuery,
    pyqTopicFilter: isQuestionPracticeRequest ? pyqTopicFilter : (bestSylScore >= 0.50 ? matchedSyllabusTopic : ''),
    matchedSyllabusTopic: bestSylScore >= 0.42 ? matchedSyllabusTopic : null,
    prerequisiteTargets,
    needsPrerequisiteLookup: prerequisiteTargets.length > 0,
    isExplicitChapterTeachRequest,
    isConfusionFollowUp,
    isExampleFollowUp,
    isQuestionPracticeRequest,
    isPyqSolveRequest: Boolean(isPyqSolveRequest),
    isPyqDiscoveryRequest: Boolean(isPyqDiscoveryRequest),
    targetQuestionNumber,
    targetExamYear,
    targetExamType,
    isRepeatedPyqRequest,
    isSummaryRequest,
    isFollowUp: Boolean(isShortFollowUp && (lastUserQuestion || lastAssistantMessage)),
    lastUserQuestion,
    lastAssistantMessage: lastAssistantMessage ? lastAssistantMessage.slice(0, 1200) : ''
  };
}

/**
 * Deduplicates evidence passages across Level 1 and Level 2 and enforces a strict token/character budget.
 */
function buildUnifiedChapterEvidenceContext({
  bundle,
  reasoning,
  activeChapterChunks = [],
  activeChapterItems = [],
  prerequisiteChunks = [],
  pyqQuestions = [],
  pyqAnalytics = null,
  maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS,
  maxContextChars = null
} = {}) {
  const effectiveMaxTokens = Math.max(250, Number(maxContextTokens) || DEFAULT_MAX_CONTEXT_TOKENS);
  const effectiveMaxChars = Number(maxContextChars) > 0
    ? Number(maxContextChars)
    : effectiveMaxTokens * CHARS_PER_TOKEN_ESTIMATE;

  let usedChars = 0;
  let deduplicatedCount = 0;
  let truncatedByBudgetCount = 0;
  const seenFingerprints = new Set();
  const seenTokenSets = [];

  const isDuplicatePassage = (text = '') => {
    const norm = normalizeText(text);
    if (!norm) return true;
    const fp = norm.slice(0, 180);
    if (seenFingerprints.has(fp)) return true;

    const tokens = new Set(norm.split(/\s+/).filter((w) => w.length >= 3));
    if (tokens.size >= 6) {
      for (const prevSet of seenTokenSets) {
        let intersection = 0;
        for (const t of tokens) {
          if (prevSet.has(t)) intersection += 1;
        }
        const union = tokens.size + prevSet.size - intersection;
        if (union > 0 && intersection / union >= 0.78) {
          return true;
        }
      }
    }

    seenFingerprints.add(fp);
    if (tokens.size >= 6) seenTokenSets.push(tokens);
    return false;
  };

  const tryAllocate = (text = '') => {
    const str = String(text || '').trim();
    if (!str) return null;
    if (usedChars + str.length <= effectiveMaxChars) {
      usedChars += str.length;
      return str;
    }
    const remaining = effectiveMaxChars - usedChars;
    if (remaining >= 160) {
      const sliced = `${str.slice(0, remaining - 3).trim()}...`;
      usedChars += sliced.length;
      truncatedByBudgetCount += 1;
      return sliced;
    }
    truncatedByBudgetCount += 1;
    return null;
  };

  // 1. Active Chapter Evidence (Priority 1)
  const activeChapterEvidence = [];
  for (const ch of activeChapterChunks) {
    if (isDuplicatePassage(ch.content)) {
      deduplicatedCount += 1;
      continue;
    }
    const budgetedText = tryAllocate(ch.content);
    if (!budgetedText) continue;
    activeChapterEvidence.push({
      id: ch.id,
      subject: bundle.subject,
      subjectCode: bundle.subjectCode,
      semesterNo: bundle.semesterNo,
      chapter: ch.chapter || bundle.chapterTitle,
      unit: ch.unit || bundle.unitNumber,
      topic: ch.sectionHeading || reasoning.matchedSyllabusTopic || reasoning.resolvedTopicQuery,
      documentTitle: ch.fileTitle,
      resourceCategory: ch.resourceCategory || 'notes',
      pageNumber: ch.pageStart || 1,
      pageEnd: ch.pageEnd || ch.pageStart || 1,
      fileId: ch.fileId,
      relevanceScore: Number((ch.relevanceScore ?? Math.min(1, (ch.score || 1) / 8)).toFixed(3)),
      confidence: 'high',
      evidenceOrigin: 'active_chapter',
      sectionHeading: ch.sectionHeading || '',
      content: budgetedText
    });
  }

  for (const it of activeChapterItems.slice(0, 4)) {
    if (isDuplicatePassage(it.contentText)) {
      deduplicatedCount += 1;
      continue;
    }
    const budgetedText = tryAllocate(it.contentText);
    if (!budgetedText) continue;
    activeChapterEvidence.push({
      id: `item_${it.id}`,
      subject: bundle.subject,
      subjectCode: bundle.subjectCode,
      semesterNo: bundle.semesterNo,
      chapter: bundle.chapterTitle,
      unit: bundle.unitNumber,
      topic: it.title || reasoning.matchedSyllabusTopic || reasoning.resolvedTopicQuery,
      documentTitle: it.fileTitle,
      resourceCategory: 'notes',
      pageNumber: it.pageStart || 1,
      pageEnd: it.pageEnd || it.pageStart || 1,
      fileId: it.fileId,
      relevanceScore: Number(Math.min(1, (it.score || 2) / 6).toFixed(3)),
      confidence: 'high',
      evidenceOrigin: 'active_chapter',
      itemType: it.itemType,
      sectionHeading: it.title || it.itemType || 'Extracted Item',
      content: budgetedText
    });
  }

  // 2. Official Syllabus Evidence (Priority 2)
  const officialSyllabusEvidence = [];
  if (Array.isArray(bundle.syllabusTopics) && bundle.syllabusTopics.length > 0) {
    const sylText = `Unit ${bundle.unitNumber} (${bundle.chapterTitle}): ${bundle.syllabusTopics.join(', ')}`;
    const budgetedSyl = tryAllocate(sylText);
    if (budgetedSyl) {
      officialSyllabusEvidence.push({
        subject: bundle.subject,
        subjectCode: bundle.subjectCode,
        semesterNo: bundle.semesterNo,
        chapter: bundle.chapterTitle,
        unit: bundle.unitNumber,
        topic: reasoning.matchedSyllabusTopic || bundle.chapterTitle,
        documentTitle: `${bundle.subject} Official Syllabus`,
        resourceCategory: 'syllabus',
        pageNumber: 1,
        fileId: null,
        relevanceScore: reasoning.matchedSyllabusTopic ? 0.95 : 0.80,
        confidence: 'high',
        evidenceOrigin: 'official_syllabus',
        content: budgetedSyl
      });
    }
  }

  // 3. PYQ Evidence (Priority 3)
  const pyqEvidence = [];
  for (const q of pyqQuestions.slice(0, 6)) {
    const qText = q.clean_question_text || q.question_text || '';
    if (!qText) continue;
    const budgetedQ = tryAllocate(qText);
    if (!budgetedQ) continue;
    const pageProvStatus = q.page_provenance_status || q.pageProvenanceStatus || 'verified';
    const rawPageStart = pageProvStatus === 'unavailable' ? null : (q.page_number ?? q.pageNumber ?? q.note_page_number ?? null);
    const rawPageEnd = pageProvStatus === 'unavailable' ? null : (q.page_end ?? q.pageEnd ?? rawPageStart);
    const formattedPage = formatPageProvenanceLabel(rawPageStart, rawPageEnd, pageProvStatus);
    const pageRangeLabel = pageProvStatus === 'unavailable' || formattedPage === 'Document Section'
      ? null
      : (q.page_range || q.pageRange || formattedPage);
    pyqEvidence.push({
      id: q.id,
      subject: q.subject || bundle.subject,
      subjectCode: q.subject_code || bundle.subjectCode,
      semesterNo: q.semester_no || bundle.semesterNo,
      chapter: q.chapter_title || bundle.chapterTitle,
      unit: q.unit_number || bundle.unitNumber,
      topic: q.primary_topic || q.normalized_topic || reasoning.resolvedTopicQuery,
      documentTitle: q.source_file_title || q.paper_title || `${bundle.subject} (${q.exam_year} ${q.exam_type})`,
      resourceCategory: 'pyq',
      pageNumber: rawPageStart,
      pageEnd: rawPageEnd,
      pageRange: pageRangeLabel,
      pageProvenanceStatus: pageProvStatus,
      fileId: q.source_file_id || q.file_id || null,
      examYear: q.exam_year || 'Past Exam',
      examType: q.exam_type || 'Final Exam',
      questionNumber: q.question_number || '1',
      marks: Number(q.marks) || 5,
      relevanceScore: Number(q.topic_match_score ?? q.relevance_score ?? 0.85),
      confidence: q.mapping_confidence || q.topic_confidence || 'high',
      mappingStatus: q.mapping_status || 'AUTO_CONFIRMED',
      evidenceOrigin: 'previous_year_questions',
      isActualPyq: true,
      content: budgetedQ
    });
  }

  // 4. Same-Subject Prerequisite / Related Chapter Evidence (Priority 4)
  const sameSubjectSupplementaryEvidence = [];
  for (const pre of prerequisiteChunks) {
    if (isDuplicatePassage(pre.content)) {
      deduplicatedCount += 1;
      continue;
    }
    const budgetedPre = tryAllocate(pre.content);
    if (!budgetedPre) continue;
    sameSubjectSupplementaryEvidence.push({
      id: pre.id,
      subject: pre.subject || bundle.subject,
      subjectCode: pre.subjectCode || bundle.subjectCode,
      semesterNo: pre.semesterNo || bundle.semesterNo,
      chapter: pre.chapter || 'Earlier Chapter',
      unit: pre.unit || null,
      topic: pre.prerequisiteConcept || pre.sectionHeading || reasoning.resolvedTopicQuery,
      documentTitle: pre.fileTitle,
      resourceCategory: pre.resourceCategory || 'notes',
      pageNumber: pre.pageStart || 1,
      pageEnd: pre.pageEnd || pre.pageStart || 1,
      fileId: pre.fileId,
      relevanceScore: Number((pre.relevanceScore || 0.70).toFixed(3)),
      confidence: pre.relevanceScore >= 0.65 ? 'high' : 'medium',
      evidenceOrigin: 'same_subject_prerequisite',
      prerequisiteRelationship: pre.prerequisiteReason || 'same_subject_prerequisite',
      sectionHeading: pre.sectionHeading || '',
      content: budgetedPre
    });
  }

  // 5. Model Supplementary Fallback Guidance (Priority 5)
  const needsModelSupplement =
    activeChapterEvidence.length === 0 ||
    (reasoning.needsPrerequisiteLookup && sameSubjectSupplementaryEvidence.length === 0);

  const modelSupplementaryGuidance = {
    needed: needsModelSupplement,
    evidenceOrigin: 'model_academic_fallback',
    subject: bundle.subject,
    subjectCode: bundle.subjectCode,
    semesterNo: bundle.semesterNo,
    chapter: bundle.chapterTitle,
    unit: bundle.unitNumber,
    topic: reasoning.matchedSyllabusTopic || reasoning.resolvedTopicQuery,
    confidence: 'curriculum_aligned',
    instruction: activeChapterEvidence.length === 0
      ? `Topic "${reasoning.resolvedTopicQuery}" is not covered in the uploaded active chapter PDFs. Supplement using curriculum-aligned academic knowledge for ${bundle.subject} (${bundle.chapterTitle}) and explicitly label it as supplementary academic explanation without fabricating note titles or page numbers.`
      : `Active chapter notes are available, but prerequisite details on "${reasoning.prerequisiteTargets.map((t) => t.concept).join(', ')}" were not found in other uploaded chapters. Supplement prerequisite explanation clearly.`
  };

  return {
    activeChapterEvidence,
    sameSubjectSupplementaryEvidence,
    officialSyllabusEvidence,
    pyqEvidence,
    pyqAnalytics: pyqAnalytics || {
      timesAsked: 0,
      distinctYearsCount: 0,
      examYears: [],
      repeatedTopics: [],
      repeatedQuestions: [],
      topQuestions: []
    },
    modelSupplementaryGuidance,
    budgetStats: {
      maxContextTokens: effectiveMaxTokens,
      maxContextChars: effectiveMaxChars,
      usedChars,
      usedTokensEstimate: estimateTokens('x'.repeat(usedChars)),
      deduplicatedCount,
      truncatedByBudgetCount
    }
  };
}

/**
 * Resolves the exact target PYQ question requested by the student (Defect 2).
 * Strictly requires verifiable question number, year, type, or high-confidence semantic similarity.
 * Returns null if no exact match is found (triggering clarification instead of hallucination).
 */
function findTargetPyqQuestion(questions = [], reasoning = {}) {
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const targetNum = reasoning.targetQuestionNumber
    ? String(reasoning.targetQuestionNumber).trim().toLowerCase().replace(/\s+/g, '')
    : null;
  const targetYear = reasoning.targetExamYear ? String(reasoning.targetExamYear).trim() : null;
  const targetType = reasoning.targetExamType ? String(reasoning.targetExamType).trim().toLowerCase() : null;

  // 1. Exact or partial match on Question Number (e.g. "10", "2", "2(a)", "2a")
  if (targetNum) {
    const scored = questions.map((q) => {
      let score = 0;
      const qNum = String(q.question_number || q.questionNumber || '').trim().toLowerCase().replace(/\s+/g, '');
      const qYear = String(q.exam_year || q.examYear || '').trim();
      const qType = String(q.exam_type || q.examType || '').trim().toLowerCase();
      const qTitle = String(q.documentTitle || q.source_file_title || q.paper_title || '').toLowerCase();

      const escapedTarget = targetNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedQNum = qNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isSubpart = new RegExp(`^${escapedTarget}(?:\\([a-z0-9]+\\)|[a-z]|\\.)$`, 'i').test(qNum);
      const isParent = new RegExp(`^${escapedQNum}(?:\\([a-z0-9]+\\)|[a-z]|\\.)$`, 'i').test(targetNum);

      if (qNum === targetNum) {
        score += 20;
      } else if (qNum.replace(/[^0-9a-z]/g, '') === targetNum.replace(/[^0-9a-z]/g, '')) {
        score += 15;
      } else if (isSubpart || isParent) {
        score += 8;
      } else {
        return { q, score: 0 };
      }

      if (targetYear && (qYear === targetYear || qTitle.includes(targetYear))) {
        score += 10;
      }
      if (targetType && (qType.includes(targetType) || qTitle.includes(targetType))) {
        score += 10;
      }
      return { q, score };
    }).filter((x) => x.score >= 8);

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      return scored[0].q;
    }
  }

  // 2. High-confidence semantic match on question text / topic (if explicitly requested without question number)
  const queryStr = reasoning.pyqTopicFilter || reasoning.resolvedTopicQuery;
  if (queryStr && queryStr.length >= 3) {
    const qNorm = normalizeText(queryStr);
    let best = null;
    let bestScore = 0;
    for (const q of questions) {
      const textNorm = normalizeText(q.clean_question_text || q.question_text || q.content || '');
      const score = computeTopicSimilarity(textNorm, qNorm);
      if (score > bestScore && score >= 0.50) {
        bestScore = score;
        best = q;
      }
    }
    if (best) return best;
  }

  return null;
}

/**
 * Stage 2 of the Chapter Tutor Pipeline:
 * Executes the 3-Level Hierarchical Retrieval + PYQ Intelligence + Unified Bounded Evidence Assembly.
 */
async function retrieveChapterEvidence(db, bundle, reasoning, options = {}) {
  const fileIds = (bundle.files || []).map((f) => f.id);
  const queryText = reasoning.resolvedTopicQuery || reasoning.originalQuestion || '';
  const normQuery = normalizeText(queryText);
  const academicContext = options.academicContext
    ? (options.academicContext.authenticated !== undefined ? options.academicContext : { ...options.academicContext, authenticated: true })
    : null;

  const stopWords = new Set([
    'what', 'is', 'are', 'the', 'in', 'of', 'to', 'and', 'for', 'how', 'why', 'explain',
    'define', 'tell', 'me', 'about', 'can', 'you', 'give', 'example', 'examples', 'this',
    'chapter', 'unit', 'notes', 'pdf', 'from', 'with', 'understand', 'dont', 'please',
    'show', 'questions', 'question', 'important', 'exam', 'prepare', 'previous', 'year', 'pyq'
  ]);
  const queryTokens = normQuery
    .split(/\s+/)
    .map((w) => w.replace(/(?:es|s|ing|ed)$/, ''))
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const matchedChunks = [];
  const matchedItems = [];

  // ============================================================================
  // LEVEL 1: ACTIVE CHAPTER RETRIEVAL (PRIMARY SOURCE)
  // ============================================================================
  if (fileIds.length > 0) {
    const ragActive = await retrieveAcademicEvidence(db, {
      query: queryText,
      user: academicContext,
      subject: bundle.rawSubject || bundle.subject,
      subjectCode: bundle.subjectCode !== 'COURSE' ? bundle.subjectCode : null,
      semester: bundle.semesterNo,
      allowedFileIds: fileIds,
      allowCrossSemester: false,
      maxChunks: 6,
      minRelevanceScore: 0.26
    }).catch(() => ({ passages: [] }));

    const ragByChunkId = new Map();
    for (const p of ragActive.passages || []) {
      ragByChunkId.set(String(p.chunkId), p);
    }

    const placeholders = fileIds.map(() => '?').join(',');
    const fileFilterSql = db.isPostgres
      ? `CAST(c.file_id AS INTEGER) IN (${placeholders})`
      : `(CAST(c.file_id AS INTEGER) IN (${placeholders}) OR c.file_id IN (${placeholders.split(',').map(() => '?').join(',')}))`;
    const fileFilterParams = db.isPostgres
      ? [...fileIds]
      : [...fileIds, ...fileIds.map(String)];

    const allChapterChunks = await db.all(
      `SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end, c.section_heading, c.clean_content,
              c.chapter, c.unit,
              f.title AS file_title, f.originalName AS original_name
       FROM document_chunks c
       JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
       WHERE ${fileFilterSql}
         AND COALESCE(c.chunk_level, 'child') = 'child'
       ORDER BY c.file_id ASC, c.page_start ASC, c.chunk_index ASC`,
      ...fileFilterParams
    ).catch(() => []);

    for (const ch of allChapterChunks || []) {
      const headingNorm = normalizeText(ch.section_heading || ch.sectionHeading || '');
      const bodyNorm = normalizeText(ch.clean_content || ch.cleanContent || '');
      const combined = `${headingNorm} ${bodyNorm}`;
      const ragHit = ragByChunkId.get(String(ch.id));

      let score = ragHit ? ragHit.relevanceScore * 6.0 : 0;
      if (normQuery && normQuery.length >= 3 && combined.includes(normQuery)) {
        score += 5;
      }
      if (reasoning.matchedSyllabusTopic) {
        const sylNorm = normalizeText(reasoning.matchedSyllabusTopic);
        if (sylNorm && combined.includes(sylNorm)) score += 4;
      }
      for (const tok of queryTokens) {
        if (headingNorm.includes(tok)) score += 2.5;
        else if (bodyNorm.includes(tok)) score += 1.2;
      }

      if ((reasoning.isSummaryRequest || (reasoning.isQuestionPracticeRequest && !reasoning.pyqTopicFilter)) && score === 0) {
        score = 0.6;
      }

      if (score > 0) {
        const baseRel = ragHit ? ragHit.relevanceScore : Math.min(0.85, score / 8.0);
        const relevanceScore = Number(Math.min(1.0, baseRel + 0.20).toFixed(4));
        matchedChunks.push({
          id: ch.id,
          fileId: Number(ch.file_id ?? ch.fileId),
          fileTitle: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName || 'Chapter Note',
          chapter: ch.chapter || bundle.chapterTitle,
          unit: ch.unit || bundle.unitNumber,
          resourceCategory: 'notes',
          pageStart: Number(ch.page_start ?? ch.pageStart ?? 1),
          pageEnd: Number(ch.page_end ?? ch.pageEnd ?? 1),
          sectionHeading: ch.section_heading || ch.sectionHeading || '',
          content: String(ch.clean_content || ch.cleanContent || '').trim(),
          score,
          relevanceScore,
          evidenceOrigin: 'active_chapter'
        });
      }
    }

    if (matchedChunks.length === 0) {
      for (const f of bundle.files || []) {
        for (const p of f.pages || []) {
          const pNorm = normalizeText(p.text || '');
          let score = 0;
          if (normQuery && normQuery.length >= 3 && pNorm.includes(normQuery)) score += 4;
          for (const tok of queryTokens) {
            if (pNorm.includes(tok)) score += 1.2;
          }
          if (reasoning.isSummaryRequest && score === 0) score = 0.5;
          if (score > 0) {
            matchedChunks.push({
              id: `page_${f.id}_${p.pageNumber}`,
              fileId: f.id,
              fileTitle: f.title,
              chapter: f.chapter || bundle.chapterTitle,
              unit: f.unitNumber || bundle.unitNumber,
              resourceCategory: f.resourceCategory || 'notes',
              pageStart: p.pageNumber,
              pageEnd: p.pageNumber,
              sectionHeading: f.title,
              content: p.text.slice(0, 900),
              score,
              relevanceScore: Number(Math.min(1.0, score / 6.0 + 0.15).toFixed(4)),
              evidenceOrigin: 'active_chapter'
            });
          }
        }
      }
    }

    for (const f of bundle.files || []) {
      for (const it of f.extractedItems || []) {
        const itNorm = normalizeText(`${it.title || ''} ${it.contentText || ''}`);
        let score = 0;
        if (normQuery && normQuery.length >= 3 && itNorm.includes(normQuery)) score += 4;
        for (const tok of queryTokens) {
          if (itNorm.includes(tok)) score += 1.5;
        }
        if (reasoning.isExampleFollowUp && (it.itemType === 'code_example' || it.itemType === 'worked_example')) {
          score += 2.5;
        }
        if (reasoning.isQuestionPracticeRequest && it.itemType === 'inline_question') {
          score += 3;
        }
        if (score > 0) {
          matchedItems.push({
            ...it,
            fileId: f.id,
            fileTitle: f.title,
            score,
            evidenceOrigin: 'active_chapter'
          });
        }
      }
    }
  }

  matchedChunks.sort((a, b) => b.score - a.score);
  matchedItems.sort((a, b) => b.score - a.score);

  const topChunks = matchedChunks.slice(0, 6);
  const topItems = matchedItems.slice(0, 8);
  const foundInChapterFiles = topChunks.some((c) => c.score >= 1.2) || topItems.some((i) => i.score >= 1.5);

  const activeCombinedText = normalizeText(
    topChunks.map((c) => `${c.sectionHeading} ${c.content}`).join(' ') + ' ' +
    topItems.map((i) => `${i.title} ${i.contentText}`).join(' ')
  );
  const uncoveredQueryTokens = queryTokens.filter((tok) => tok.length >= 3 && !activeCombinedText.includes(tok));
  const uncoveredPrereqTargets = (reasoning.prerequisiteTargets || []).filter(
    (pt) => !activeCombinedText.includes(pt.normalizedConcept)
  );

  // ============================================================================
  // LEVEL 2: SAME-SUBJECT PREREQUISITE & RELATED-CHAPTER RETRIEVAL
  // ============================================================================
  const prerequisiteChunks = [];
  const shouldRunLevel2 =
    !reasoning.isSummaryRequest &&
    Boolean(bundle.subject || bundle.rawSubject) &&
    (
      uncoveredPrereqTargets.length > 0 ||
      reasoning.needsPrerequisiteLookup ||
      !foundInChapterFiles ||
      uncoveredQueryTokens.length > 0
    );

  if (shouldRunLevel2) {
    const level2Queries = [];
    if (uncoveredPrereqTargets.length > 0) {
      level2Queries.push({
        query: uncoveredPrereqTargets.map((t) => t.concept).join(' '),
        reason: uncoveredPrereqTargets[0].sourceReason || 'same_subject_prerequisite',
        targetTerms: uncoveredPrereqTargets.map((t) => t.normalizedConcept)
      });
    } else if (reasoning.prerequisiteTargets.length > 0) {
      level2Queries.push({
        query: reasoning.prerequisiteTargets.map((t) => t.concept).join(' '),
        reason: reasoning.prerequisiteTargets[0].sourceReason || 'same_subject_prerequisite',
        targetTerms: reasoning.prerequisiteTargets.map((t) => t.normalizedConcept)
      });
    }
    if (!foundInChapterFiles || uncoveredQueryTokens.length > 0) {
      const fallbackSubQuery = uncoveredQueryTokens.length > 0 ? uncoveredQueryTokens.join(' ') : queryText;
      if (fallbackSubQuery && !level2Queries.some((q) => normalizeText(q.query) === normalizeText(fallbackSubQuery))) {
        level2Queries.push({
          query: fallbackSubQuery,
          reason: 'same_subject_cross_chapter',
          targetTerms: uncoveredQueryTokens.length > 0 ? uncoveredQueryTokens : queryTokens
        });
      }
    }

    const seenPrereqChunkIds = new Set();
    for (const l2 of level2Queries.slice(0, 2)) {
      const ragSameSubject = await retrieveAcademicEvidence(db, {
        query: l2.query,
        user: academicContext,
        subject: bundle.rawSubject || bundle.subject,
        subjectCode: bundle.subjectCode !== 'COURSE' ? bundle.subjectCode : null,
        semester: bundle.semesterNo,
        excludedFileIds: fileIds,
        allowCrossSemester: false,
        maxChunks: 4,
        minRelevanceScore: 0.32
      }).catch(() => ({ passages: [] }));

      for (const p of ragSameSubject.passages || []) {
        if (seenPrereqChunkIds.has(String(p.chunkId))) continue;
        if (fileIds.includes(Number(p.fileId))) continue;

        const isSameSubject =
          isSameAcademicSubject(p.subject, p.subjectCode, bundle.subject, bundle.subjectCode) ||
          isSameAcademicSubject(p.subject, p.subjectCode, bundle.rawSubject, bundle.subjectCode);
        if (!isSameSubject) continue;

        const pCombinedNorm = normalizeText(`${p.sectionHeading || ''} ${p.title || ''} ${p.content || ''}`);
        const hasTargetHit = (l2.targetTerms || []).some((term) => term && pCombinedNorm.includes(term));
        if (!hasTargetHit && p.relevanceScore < 0.55) continue;

        seenPrereqChunkIds.add(String(p.chunkId));
        prerequisiteChunks.push({
          id: p.chunkId,
          fileId: Number(p.fileId),
          fileTitle: p.title,
          subject: p.subject || bundle.subject,
          subjectCode: p.subjectCode || bundle.subjectCode,
          semesterNo: p.semesterNo || bundle.semesterNo,
          chapter: p.chapter || (p.unit ? `Unit ${p.unit}` : 'Related Chapter'),
          unit: p.unit || null,
          resourceCategory: p.resourceCategory || 'notes',
          pageStart: p.pageStart || 1,
          pageEnd: p.pageEnd || p.pageStart || 1,
          sectionHeading: p.sectionHeading || '',
          content: p.content,
          relevanceScore: Number(Math.min(0.88, p.relevanceScore).toFixed(4)),
          prerequisiteConcept: l2.query,
          prerequisiteReason: l2.reason,
          evidenceOrigin: 'same_subject_prerequisite'
        });
      }
    }
  }

  // ============================================================================
  // PYQ INTELLIGENCE RETRIEVAL (PAST EXAM QUESTIONS & ANALYTICS)
  // ============================================================================
  const isChapterWidePyqRequest = reasoning.isQuestionPracticeRequest && !reasoning.pyqTopicFilter;

  let pyqQuestions = [];
  let targetPyqQuestion = null;
  let pyqAnalytics = {
    timesAsked: 0,
    distinctYearsCount: 0,
    examYears: [],
    examTypes: {},
    averageMarks: 0,
    totalMarksWeight: 0,
    repeatedTopics: [],
    repeatedQuestions: [],
    topQuestions: []
  };

  if (bundle.subject) {
    const isPyqSolve = Boolean(reasoning.isPyqSolveRequest);
    const specificTopicQuery = reasoning.pyqTopicFilter || reasoning.matchedSyllabusTopic || (!isChapterWidePyqRequest && !isPyqSolve ? queryTokens.slice(0, 4).join(' ') : '');

    if (isChapterWidePyqRequest || isPyqSolve) {
      pyqAnalytics = await getTopicPyqAnalytics(db, {
        subject: bundle.rawSubject || bundle.subject,
        subjectCode: bundle.subjectCode !== 'COURSE' ? bundle.subjectCode : undefined,
        semesterNo: bundle.semesterNo,
        unitNumber: isPyqSolve ? undefined : bundle.unitNumber,
        academicContext,
        allowCrossSemester: false,
        rejectWeakMatches: false
      }).catch(() => pyqAnalytics);
      pyqQuestions = pyqAnalytics.topQuestions || [];
    } else if (specificTopicQuery && specificTopicQuery.length >= 2) {
      pyqAnalytics = await getTopicPyqAnalytics(db, {
        subject: bundle.rawSubject || bundle.subject,
        subjectCode: bundle.subjectCode !== 'COURSE' ? bundle.subjectCode : undefined,
        semesterNo: bundle.semesterNo,
        targetTopic: specificTopicQuery,
        academicContext,
        allowCrossSemester: false,
        rejectWeakMatches: true,
        minTopicScore: 0.55
      }).catch(() => pyqAnalytics);

      pyqQuestions = (pyqAnalytics.topQuestions || []).filter(
        (q) => (q.topic_match_score ?? 0) >= 0.55 && q.topic_confidence !== 'low'
      );
      pyqAnalytics = {
        ...pyqAnalytics,
        timesAsked: pyqQuestions.length,
        distinctYearsCount: new Set(pyqQuestions.map((q) => q.exam_year).filter(Boolean)).size,
        examYears: Array.from(new Set(pyqQuestions.map((q) => q.exam_year).filter(Boolean))).sort().reverse(),
        topQuestions: pyqQuestions
      };
    }

    if (isPyqSolve) {
      const directQuestions = await searchPyqQuestions(db, {
        subject: bundle.rawSubject || bundle.subject,
        subjectCode: bundle.subjectCode !== 'COURSE' ? bundle.subjectCode : undefined,
        semesterNo: bundle.semesterNo,
        examYear: reasoning.targetExamYear || undefined,
        limit: 100
      }).catch(() => []);

      const candidatePool = [...pyqQuestions];
      for (const dq of directQuestions) {
        if (!candidatePool.some((c) => c.id === dq.id)) {
          candidatePool.push(dq);
        }
      }

      const resolvedQ = findTargetPyqQuestion(candidatePool, reasoning);
      if (resolvedQ) {
        targetPyqQuestion = resolvedQ;
        if (!pyqQuestions.some((q) => q.id === resolvedQ.id)) {
          pyqQuestions.unshift(resolvedQ);
        }
      }
    }
  }

  const unifiedContext = buildUnifiedChapterEvidenceContext({
    bundle,
    reasoning,
    activeChapterChunks: topChunks,
    activeChapterItems: topItems,
    prerequisiteChunks,
    pyqQuestions,
    pyqAnalytics,
    maxContextTokens: options.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS,
    maxContextChars: options.maxContextChars || null
  });

  const unifiedTarget = targetPyqQuestion
    ? (unifiedContext.pyqEvidence.find((q) => q.id === targetPyqQuestion.id) || {
        id: targetPyqQuestion.id,
        content: targetPyqQuestion.clean_question_text || targetPyqQuestion.question_text || targetPyqQuestion.content,
        examYear: targetPyqQuestion.exam_year || targetPyqQuestion.examYear || 'Past Board Exam',
        examType: targetPyqQuestion.exam_type || targetPyqQuestion.examType || 'Final Exam',
        questionNumber: targetPyqQuestion.question_number || targetPyqQuestion.questionNumber || 'Q',
        marks: targetPyqQuestion.marks || 5,
        topic: targetPyqQuestion.primary_topic || targetPyqQuestion.normalized_topic || bundle.chapterTitle,
        documentTitle: targetPyqQuestion.source_file_title || targetPyqQuestion.paper_title || bundle.subject,
        pageNumber: targetPyqQuestion.page_number ?? targetPyqQuestion.pageNumber ?? null,
        pageEnd: targetPyqQuestion.page_end ?? targetPyqQuestion.pageEnd ?? null,
        pageProvenanceStatus: targetPyqQuestion.page_provenance_status || targetPyqQuestion.pageProvenanceStatus || 'verified'
      })
    : null;

  return {
    foundInChapterFiles,
    foundInSameSubjectPrerequisites: unifiedContext.sameSubjectSupplementaryEvidence.length > 0,
    foundPyqQuestions: unifiedContext.pyqEvidence.length > 0,
    targetPyqQuestion: unifiedTarget,
    pyqClarificationNeeded: Boolean(reasoning.isPyqSolveRequest && !targetPyqQuestion),
    topChunks,
    topItems,
    prerequisiteChunks: unifiedContext.sameSubjectSupplementaryEvidence,
    pyqQuestions: unifiedContext.pyqEvidence,
    pyqAnalytics: unifiedContext.pyqAnalytics,
    unifiedContext,
    allFilesSummary: (bundle.files || []).map((f) => ({
      id: f.id,
      title: f.title,
      pageCount: f.pageCount,
      firstPageExcerpt: f.pages?.[0]?.text ? f.pages[0].text.slice(0, 350) : ''
    }))
  };
}

function formatPyqIntelligenceSection(evidence, bundle, reasoning) {
  const pyqs = evidence.pyqQuestions || [];
  const analytics = evidence.pyqAnalytics || {};
  const lines = [];

  if (pyqs.length > 0) {
    const yearsStr = Array.isArray(analytics.examYears) && analytics.examYears.length > 0
      ? analytics.examYears.join(', ')
      : pyqs.map((q) => q.examYear).filter(Boolean).join(', ');
    lines.push(
      `### Past Exam Questions (Verified Gandaki University PYQs)`
    );
    lines.push(
      `**Exam Appearance Analytics:** Asked **${analytics.timesAsked || pyqs.length} time(s)** across **${analytics.distinctYearsCount || 1} exam year(s)** (${yearsStr}).`
    );

    if (Array.isArray(analytics.repeatedTopics) && analytics.repeatedTopics.some((rt) => rt.isRepeated)) {
      const repeatedList = analytics.repeatedTopics
        .filter((rt) => rt.isRepeated)
        .map((rt) => `**${rt.topic}** (asked ${rt.timesAsked}× in ${rt.examYears.join(', ')})`)
        .join(', ');
      lines.push(`**Repeated High-Priority Topics:** ${repeatedList}`);
    }

    const repeatedIds = new Set((analytics.repeatedQuestions || []).map((rq) => rq.id));
    const questionsToShow = reasoning.isRepeatedPyqRequest && repeatedIds.size > 0
      ? [...pyqs.filter((q) => repeatedIds.has(q.id)), ...pyqs.filter((q) => !repeatedIds.has(q.id))]
      : pyqs;

    for (const q of (questionsToShow.length > 0 ? questionsToShow : pyqs).slice(0, 5)) {
      const pageLabelStr = formatPageProvenanceLabel(q.pageNumber, q.pageEnd, q.pageProvenanceStatus);
      const pageLabel = q.pageProvenanceStatus === 'unavailable' || pageLabelStr === 'Document Section'
        ? ''
        : `, ${q.pageRange || pageLabelStr}`;
      const sourceRef = q.documentTitle ? ` | Source: *${q.documentTitle}*${pageLabel}` : '';
      lines.push(
        `- **[${q.examYear} ${q.examType} — Q.${q.questionNumber} (${q.marks} Marks)]** ${q.content}\n  *(Topic: ${q.topic} · Confidence: ${q.confidence}${sourceRef})*`
      );
    }
    return lines.join('\n\n');
  }

  if (reasoning.isQuestionPracticeRequest) {
    const topicLabel = reasoning.pyqTopicFilter || reasoning.matchedSyllabusTopic || bundle.chapterTitle;
    lines.push(`### Exam Preparation & Practice Questions (${topicLabel})`);
    lines.push(
      `*PYQ Status:* No verified past exam papers (PYQs) are currently indexed in Semester Library for **${topicLabel}** in **${bundle.subject}**. Below are curriculum-aligned **AI-Generated Practice Questions** (not past board questions) to help you prepare:`
    );
    const sampleTopics = bundle.syllabusTopics && bundle.syllabusTopics.length > 0
      ? bundle.syllabusTopics.slice(0, 3)
      : [topicLabel];
    sampleTopics.forEach((st, idx) => {
      lines.push(`- **[AI-Generated Practice Q${idx + 1} (5 Marks)]** Define and explain **${st}** with a practical example in the context of ${bundle.subject}.`);
    });
    return lines.join('\n\n');
  }

  return '';
}

/**
 * Renders a structured step-by-step worked solution for a specific verified past exam question (Defect 2).
 * Integrates formulas, definitions, and code examples from active chapter notes and preserves verified exam provenance.
 */
function formatPyqStepByStepSolution(targetQ, evidence = {}, bundle = {}, reasoning = {}) {
  const parts = [];
  const pageLabelStr = formatPageProvenanceLabel(targetQ.pageNumber, targetQ.pageEnd, targetQ.pageProvenanceStatus);
  const sourceRef = targetQ.documentTitle ? ` | Source: *${targetQ.documentTitle}* (${pageLabelStr})` : '';

  parts.push(`### Step-by-Step Worked Solution: ${targetQ.examYear} ${targetQ.examType} — Q.${targetQ.questionNumber} (${targetQ.marks} Marks)`);
  parts.push(
    `**Verified Exam Question Statement:**\n> ${targetQ.content}\n\n*(Exam Provenance: Gandaki University ${targetQ.examYear} ${targetQ.examType} · Question ${targetQ.questionNumber} · Marks: ${targetQ.marks} · Topic: **${targetQ.topic}**${sourceRef})*`
  );

  // Step 1: Core Concept / Definition & Formula
  const defItem = (evidence.topItems || []).find((it) => it.itemType === 'definition' || it.itemType === 'formula');
  const primaryNote = evidence.unifiedContext?.activeChapterEvidence?.[0] || null;

  parts.push(`**Step 1: Governing Concept & Definition**`);
  if (defItem) {
    const dPage = formatPageProvenanceLabel(defItem.pageStart, defItem.pageEnd);
    parts.push(`According to your chapter notes (*${defItem.fileTitle}*, ${dPage}):\n> ${defItem.contentText}`);
  } else if (primaryNote) {
    const pPage = formatPageProvenanceLabel(primaryNote.pageNumber, primaryNote.pageEnd);
    parts.push(`Based on your active chapter notes (*${primaryNote.documentTitle}*, ${pPage}):\n${primaryNote.content.slice(0, 320)}...`);
  } else {
    parts.push(`**${targetQ.topic || bundle.chapterTitle}** is a core syllabus concept in **${bundle.subject}** (${bundle.chapterTitle}). Solving this problem requires identifying the formal governing rules and verifying boundary conditions.`);
  }

  // Step 2: Step-by-Step Working / Derivation / Implementation
  parts.push(`**Step 2: Step-by-Step Working & Solution Breakdown**`);
  const exItem = (evidence.topItems || []).find((it) => it.itemType === 'code_example' || it.itemType === 'worked_example');
  if (exItem) {
    const exPage = formatPageProvenanceLabel(exItem.pageStart, exItem.pageEnd);
    const lang = /\b(?:c|cpp|java|python|sql|html|css|js)\b/i.exec(bundle.subject || '')?.[0]?.toLowerCase() || 'text';
    parts.push(`Relevant worked example from chapter notes (*${exItem.fileTitle}*, ${exPage}):\n\`\`\`${lang}\n${exItem.contentText}\n\`\`\``);
  }
  parts.push(
    `1. **Given Parameters & Identification:** Identify all given inputs, state conditions, and constraints specified in the question.\n` +
    `2. **Methodological Execution:** Apply the standard university examination method for **${targetQ.topic || bundle.chapterTitle}** step by step.\n` +
    `3. **Step-by-Step Transition / Derivation:** Work systematically through all intermediate equations, state transitions, or algorithmic statements.`
  );

  // Step 3: Exam Marks Allocation & Criteria (${targetQ.marks} Marks)
  parts.push(
    `**Step 3: Exam Evaluation Criteria & Marks Allocation (${targetQ.marks} Marks)**\n` +
    `To achieve full marks on this **${targetQ.marks}-mark** question in Gandaki University examinations:\n` +
    `- **Mathematical / Theoretical Rigor:** Clearly write out formal definitions and state any assumed theorems.\n` +
    `- **Step Visibility:** Do not skip intermediate transitions; each reasoning step is awarded partial credit.\n` +
    `- **Clarity & Units:** Provide explicit concluding statements with proper notation and domain constraints.`
  );

  // Step 4: Final Conclusion
  parts.push(
    `**Step 4: Final Result & Summary**\n` +
    `The question asked in **${targetQ.examYear} ${targetQ.examType} (Q.${targetQ.questionNumber})** is systematically solved using the steps above. Refer to your active chapter notes for related practice problems.`
  );

  if (primaryNote) {
    const pPage = formatPageProvenanceLabel(primaryNote.pageNumber, primaryNote.pageEnd);
    parts.push(`*Reference in Chapter Notes:* [${primaryNote.documentTitle}, ${pPage}]`);
  }

  return parts.join('\n\n');
}

/**
 * Prompts the student for clarification when an exact past question number or paper cannot be found (Defect 2).
 * Strictly avoids hallucinating or guessing past exam questions.
 */
function formatPyqClarificationResponse(bundle = {}, reasoning = {}, availablePyqs = []) {
  const parts = [];
  const targetDesc = [
    reasoning.targetQuestionNumber ? `Question ${reasoning.targetQuestionNumber}` : '',
    reasoning.targetExamYear ? `from ${reasoning.targetExamYear}` : '',
    reasoning.targetExamType || ''
  ].filter(Boolean).join(' ') || 'the requested question';

  parts.push(`### Past Question Clarification Needed: ${bundle.subject} (${bundle.chapterTitle})`);
  parts.push(
    `I could not locate **${targetDesc}** among the verified past exam papers currently indexed for **${bundle.subject}** (${bundle.chapterTitle}).`
  );

  if (Array.isArray(availablePyqs) && availablePyqs.length > 0) {
    parts.push(`**Available verified past exam questions for ${bundle.chapterTitle}:**`);
    for (const q of availablePyqs.slice(0, 5)) {
      const pageLabel = formatPageProvenanceLabel(q.pageNumber, q.pageEnd, q.pageProvenanceStatus);
      const sourceRef = q.documentTitle ? ` (*${q.documentTitle}*, ${pageLabel})` : '';
      parts.push(`- **Q.${q.questionNumber}** (${q.examYear} ${q.examType}, ${q.marks} Marks): ${q.content.slice(0, 110)}${q.content.length > 110 ? '...' : ''}${sourceRef}`);
    }
  }

  parts.push(
    `*Note on Academic Integrity:* To prevent misleading exam guidance, Kyana does not invent or guess past university examination questions. Please double-check the question number or paste the exact question text, and I will be happy to solve it step by step!`
  );

  return parts.join('\n\n');
}

/**
 * Stage 3 & 4 of the Chapter Tutor Pipeline:
 * Synthesizes the Unified Chapter Tutor response.
 */
async function answerWithChapterContext(db, options = {}) {
  const {
    message,
    history = [],
    chapterContext = {},
    generateReplyFn = null,
    signal,
    maxContextTokens = DEFAULT_MAX_CONTEXT_TOKENS,
    maxContextChars = null
  } = options;
  const hasAcademicContextProp = Object.prototype.hasOwnProperty.call(options, 'academicContext');

  const bundle = await getChapterReaderBundle(db, {
    subject: chapterContext.subject,
    subjectCode: chapterContext.subjectCode,
    semesterNo: chapterContext.semesterNo,
    unitNumber: chapterContext.unitNumber,
    chapterTitle: chapterContext.chapterTitle || chapterContext.chapter,
    fileIds: chapterContext.fileIds,
    userMessage: message,
    ...(hasAcademicContextProp ? { academicContext: options.academicContext } : {})
  });

  const reasoning = analyzeChapterStudentQuestion(
    message,
    history,
    bundle.syllabusTopics,
    bundle.courseUnits,
    bundle.unitNumber,
    bundle.chapterTitle
  );

  if (reasoning.isExplicitChapterTeachRequest) {
    return {
      delegateToStudyPartner: true,
      bundle,
      reasoning
    };
  }

  const evidence = await retrieveChapterEvidence(db, bundle, reasoning, {
    academicContext: options.academicContext,
    maxContextTokens,
    maxContextChars
  });

  const presentationPlan = planAdaptivePresentation(reasoning.resolvedTopicQuery || reasoning.originalQuestion, {
    foundInChapterFiles: evidence.foundInChapterFiles,
    hasPyq: reasoning.isQuestionPracticeRequest || evidence.foundPyqQuestions
  });

  const syllabusListText = bundle.syllabusTopics.length > 0
    ? bundle.syllabusTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : 'Official syllabus topics for this chapter.';

  const conflictResult = await detectAcademicEvidenceConflicts(db, evidence.topChunks, {
    academicContext: options.academicContext
  });

  const activeEvidenceBlocks = evidence.unifiedContext.activeChapterEvidence.map((ch, idx) => {
    const pageLabel = formatPageProvenanceLabel(ch.pageNumber, ch.pageEnd);
    return `[Active Chapter Source ${idx + 1}: "${ch.documentTitle}" | Chapter: ${ch.chapter} | ${pageLabel}${ch.sectionHeading ? ` | Section: ${ch.sectionHeading}` : ''}]\n${ch.content}`;
  }).join('\n\n');

  const prerequisiteEvidenceBlocks = evidence.unifiedContext.sameSubjectSupplementaryEvidence.map((pre, idx) => {
    const pageLabel = formatPageProvenanceLabel(pre.pageNumber, pre.pageEnd);
    return `[Same-Subject Prerequisite Source ${idx + 1}: "${pre.documentTitle}" | Chapter: ${pre.chapter} | ${pageLabel}${pre.sectionHeading ? ` | Section: ${pre.sectionHeading}` : ''}]\n${pre.content}`;
  }).join('\n\n');

  const pyqContextBlocks = evidence.unifiedContext.pyqEvidence.map((q, idx) => {
    const pageLabel = formatPageProvenanceLabel(q.pageNumber, q.pageEnd, q.pageProvenanceStatus);
    return `[Verified PYQ ${idx + 1}: ${q.examYear} ${q.examType} | Q.${q.questionNumber} (${q.marks} Marks) | Topic: ${q.topic} | Paper: "${q.documentTitle}", ${pageLabel}]\n${q.content}`;
  }).join('\n\n');

  const visualAssets = await retrieveChapterVisualAssets(db, bundle, reasoning, {
    academicContext: options.academicContext,
    resolveBufferFn: options.resolveBufferFn,
    resolvePageBufferFn: options.resolvePageBufferFn
  });
  const diagramDescriptionsAvailable = hasDiagramDescriptions(bundle);

  const buildTutorSystemPrompt = (assets = [], descriptionsAvailable = false, visualUnavailable = false) => {
    return [
      `You are Kyana AI, the intelligent Chapter Study Partner for Gandaki University BIT students.`,
      `You are currently inside the Split-Screen Chapter Workspace for:`,
      `- Course: ${bundle.subject} (${bundle.subjectCode}, Semester ${bundle.semesterNo})`,
      `- Active Chapter: ${bundle.chapterTitle} (Unit ${bundle.unitNumber})`,
      `- Uploaded Chapter Files (${bundle.totalFiles}): ${(bundle.files || []).map((f) => `"${f.title}"`).join(', ') || 'None uploaded yet'}`,
      ``,
      buildAdaptivePresentationPrompt(presentationPlan),
      ``,
      `HOW YOU MUST REASON AND TEACH (HIERARCHICAL EVIDENCE RULES):`,
      `1. THINK FIRST: Understand the student's exact intent.`,
      `   - Student's raw message: "${reasoning.originalQuestion}"`,
      `   - Resolved topic/intent: "${reasoning.resolvedTopicQuery}"`,
      reasoning.isFollowUp
        ? `   - CONVERSATIONAL FOLLOW-UP DETECTED: The student is following up on the previous turn ("${reasoning.lastUserQuestion || reasoning.lastAssistantMessage.slice(0, 140)}"). Address their confusion or request for an example directly!`
        : `   - Direct question or topic inquiry.`,
      `2. LEVEL 1 — ACTIVE CHAPTER EVIDENCE (PRIMARY):`,
      `   - Official Chapter Syllabus Subtopics:\n${syllabusListText}`,
      evidence.foundInChapterFiles
        ? `   - VERIFIED ACTIVE CHAPTER NOTES:\n${activeEvidenceBlocks}`
        : `   - ACTIVE CHAPTER COVERAGE: This specific topic is not detailed in the uploaded active chapter PDFs.`,
      `3. LEVEL 2 — SAME-SUBJECT PREREQUISITE EVIDENCE (SECONDARY):`,
      evidence.foundInSameSubjectPrerequisites
        ? `   - PREREQUISITE / RELATED CHAPTER NOTES FROM ${bundle.subject.toUpperCase()}:\n${prerequisiteEvidenceBlocks}\n   - Explicitly indicate when a supporting concept comes from an earlier/related chapter of ${bundle.subject} (citing its Chapter and Document Title + Page).`
        : `   - No additional cross-chapter notes required or retrieved.`,
      `4. PAST EXAM QUESTIONS (PYQ INTELLIGENCE):`,
      reasoning.isPyqSolveRequest
        ? (evidence.targetPyqQuestion
            ? `   - PYQ STEP-BY-STEP SOLVING MANDATE: The student explicitly asked to solve past exam question Q.${evidence.targetPyqQuestion.questionNumber} (${evidence.targetPyqQuestion.marks} Marks) from ${evidence.targetPyqQuestion.examYear} ${evidence.targetPyqQuestion.examType}.\n   - You MUST provide a structured, rigorous, step-by-step worked solution.\n   - Cite the exact exam provenance: ${evidence.targetPyqQuestion.examYear} ${evidence.targetPyqQuestion.examType} Q.${evidence.targetPyqQuestion.questionNumber} (${evidence.targetPyqQuestion.marks} Marks). Never alter or invent exam records.`
            : `   - PYQ CLARIFICATION MANDATE: The student asked to solve a specific PYQ (${reasoning.originalQuestion}), but this exact question could NOT be verified in the university past paper records for this chapter.\n   - You MUST NOT guess, invent, or hallucinate an exam question! Explicitly ask the student for clarification and list the available verified questions.`)
        : (evidence.foundPyqQuestions
            ? `   - VERIFIED PAST EXAM QUESTIONS (Asked ${evidence.pyqAnalytics.timesAsked} time(s) in ${evidence.pyqAnalytics.examYears.join(', ')}):\n${pyqContextBlocks}\n   - When discussing exam importance or past questions, cite the exact Exam Year, Question Number, and Marks. Never invent exam frequency.`
            : (reasoning.isQuestionPracticeRequest
              ? `   - No verified past exam papers (PYQs) are stored for this topic yet. State clearly that no past exam papers are indexed for this topic, and clearly label any practice questions you provide as "AI-Generated Practice Questions".`
              : '')),
      `5. LEVEL 3 — ACADEMIC EXPLANATION FALLBACK & SOURCE ATTRIBUTION:`,
      `   - Clearly distinguish between what comes from the student's uploaded active chapter notes, what comes from an earlier prerequisite chapter of ${bundle.subject}, and what is supplemented from general academic curriculum knowledge. Never fabricate document titles or page numbers.`,
      `6. VISUAL EVIDENCE DIRECTIVE:`,
      assets.length > 0
        ? `   - ATTACHED VISUAL ASSETS (${assets.length}): Actual image buffers are attached to this message from authorized materials:\n` +
          assets.map((va, idx) => `     * Image ${idx + 1}: "${va.title}" (${va.fileTitle}, Page ${va.pageNumber || 1})`).join('\n') +
          `\n   - Carefully inspect and analyze the actual visual content (circuit components, layout, connections, graph curves, tables) in the attached image(s) to answer the student.`
        : (visualUnavailable
            ? `   - NOTICE: Multimodal visual inspection was unavailable for this turn. Ground your answer in the available text evidence and structural diagram descriptions.`
            : (descriptionsAvailable
                ? `   - EXTRACTED DIAGRAM DESCRIPTIONS (FROM PDF): Textual diagram descriptions extracted from notes are provided above in Active Chapter Sources. Note that actual raster image pixels are NOT attached for these PDFs; refer to the structural description provided without fabricating unseen visual details.`
                : `   - No visual assets attached. Answer using textual chapter evidence and syllabus concepts.`)),
      conflictResult.hasConflict
        ? `7. MULTI-SOURCE ACADEMIC CONFLICT NOTICE:\n   Differing statements exist between authorized sources for ${conflictResult.conflicts[0].concept}:\n   - Source 1: "${conflictResult.conflicts[0].sourceA.fileTitle}" (${conflictResult.conflicts[0].sourceA.pageLabel}): "${conflictResult.conflicts[0].sourceA.assertion}"\n   - Source 2: "${conflictResult.conflicts[0].sourceB.fileTitle}" (${conflictResult.conflicts[0].sourceB.pageLabel}): "${conflictResult.conflicts[0].sourceB.assertion}"\n   CRITICAL INSTRUCTION: You must explain both perspectives objectively, citing each source. Do not silently favor one source or override authorized material.`
        : ''
    ].filter(Boolean).join('\n');
  };

  let replyText = '';
  let visualProcessingFailed = false;
  let visualFallbackTextOnly = false;
  let actualVisualAssetsUsed = visualAssets;

  const initialSystemPrompt = buildTutorSystemPrompt(visualAssets, diagramDescriptionsAvailable, false);

  if (typeof generateReplyFn === 'function') {
    if (visualAssets && visualAssets.length > 0) {
      try {
        const llmOut = await generateReplyFn({
          message: {
            text: reasoning.originalQuestion,
            images: visualAssets.map((va) => ({
              data: va.buffer,
              mimeType: va.mimeType,
              metadata: {
                fileId: va.fileId,
                pageNumber: va.pageNumber,
                title: va.title,
                description: va.description
              }
            }))
          },
          history,
          systemPrompt: initialSystemPrompt,
          tools: [],
          onDelta: () => {},
          signal,
          complex: false
        });
        replyText = String(llmOut?.reply || '').trim();
      } catch (multimodalErr) {
        // User cancellation must never retry
        if (signal?.aborted || multimodalErr.name === 'AbortError' || multimodalErr.code === 'ABORT_ERR') {
          throw multimodalErr;
        }
        // Authorization failures and refusals must never retry
        if (
          multimodalErr.code === 'UNAUTHORIZED' ||
          multimodalErr.status === 401 ||
          multimodalErr.status === 403 ||
          multimodalErr.refusal ||
          multimodalErr.code === 'REFUSAL'
        ) {
          throw multimodalErr;
        }
        // Invalid input errors must never retry
        if (
          multimodalErr.code === 'INVALID_MESSAGE' ||
          multimodalErr.code === 'INVALID_IMAGE_PAYLOAD' ||
          multimodalErr.code === 'INVALID_IMAGE_BUFFER' ||
          multimodalErr.code === 'IMAGE_MIME_MISMATCH' ||
          multimodalErr.code === 'IMAGE_TOO_LARGE' ||
          multimodalErr.code === 'IMAGE_PAYLOAD_TOO_LARGE' ||
          multimodalErr.code === 'TOO_MANY_IMAGES'
        ) {
          throw multimodalErr;
        }

        // Recoverable provider/vision failure: explicitly retry at most ONCE with text-only message
        visualProcessingFailed = true;
        actualVisualAssetsUsed = [];

        const retryPrompt = buildTutorSystemPrompt([], diagramDescriptionsAvailable, true);
        try {
          const retryOut = await generateReplyFn({
            message: reasoning.originalQuestion, // Plain string
            history,
            systemPrompt: retryPrompt,
            tools: [],
            onDelta: () => {},
            signal,
            complex: false
          });
          replyText = String(retryOut?.reply || '').trim();
          if (replyText) {
            visualFallbackTextOnly = true;
          }
        } catch (_) {}
      }
    } else {
      try {
        const llmOut = await generateReplyFn({
          message: reasoning.originalQuestion, // Plain string
          history,
          systemPrompt: initialSystemPrompt,
          tools: [],
          onDelta: () => {},
          signal,
          complex: false
        });
        replyText = String(llmOut?.reply || '').trim();
      } catch (_) {}
    }
  }

  if (!replyText) {
    if (reasoning.isPyqSolveRequest) {
      if (evidence.targetPyqQuestion) {
        replyText = formatPyqStepByStepSolution(evidence.targetPyqQuestion, evidence, bundle, reasoning);
      } else {
        replyText = formatPyqClarificationResponse(bundle, reasoning, evidence.pyqQuestions);
      }
    } else if (reasoning.isQuestionPracticeRequest) {
      const parts = [];
      const targetHeading = reasoning.pyqTopicFilter || reasoning.matchedSyllabusTopic || bundle.chapterTitle;
      parts.push(`### Exam Preparation & Past Questions: ${targetHeading} (${bundle.subject})`);
      parts.push(formatPyqIntelligenceSection(evidence, bundle, reasoning));

      if (evidence.foundInChapterFiles && evidence.unifiedContext.activeChapterEvidence.length > 0) {
        const primary = evidence.unifiedContext.activeChapterEvidence[0];
        const pageLabel = formatPageProvenanceLabel(primary.pageNumber, primary.pageEnd);
        parts.push(
          `### Key Chapter Note Reference ([${primary.documentTitle}, ${pageLabel}])\n${primary.content}`
        );
      }
      replyText = parts.filter(Boolean).join('\n\n');
    }

    if (!replyText) {
      const specializedAdaptiveFallback =
        !reasoning.isFollowUp &&
        !reasoning.isSummaryRequest &&
        !evidence.foundInChapterFiles &&
        !evidence.foundInSameSubjectPrerequisites
          ? buildAdaptiveEducationalFallback(reasoning.originalQuestion, {
              plan: presentationPlan,
              bundle,
              evidence,
              reasoning
            })
          : null;

      if (specializedAdaptiveFallback) {
        replyText = specializedAdaptiveFallback;
      } else if (
        presentationPlan.profile === 'simple_definition' &&
        evidence.foundInChapterFiles &&
        !evidence.foundInSameSubjectPrerequisites &&
        !reasoning.isExampleFollowUp &&
        !reasoning.isConfusionFollowUp
      ) {
        replyText = buildAdaptiveEducationalFallback(reasoning.originalQuestion, {
          plan: presentationPlan,
          bundle,
          evidence,
          reasoning
        });
      } else if (
        (presentationPlan.profile === 'interactive_simulation' ||
          (!evidence.foundInChapterFiles &&
            !evidence.foundInSameSubjectPrerequisites &&
            ['truth_table', 'mathematical_derivation'].includes(presentationPlan.profile))) &&
        !reasoning.isFollowUp
      ) {
        replyText = buildAdaptiveEducationalFallback(reasoning.originalQuestion, {
          plan: presentationPlan,
          bundle,
          evidence,
          reasoning
        });
      }
    }

    if (!replyText) {
      const parts = [];
      const targetHeading = reasoning.matchedSyllabusTopic || reasoning.resolvedTopicQuery || bundle.chapterTitle;

      if (reasoning.isConfusionFollowUp) {
        parts.push(`No worries at all — let's break **${targetHeading}** down in a much simpler way with a step-by-step example.`);
      } else if (reasoning.isExampleFollowUp) {
        parts.push(`Here is a practical example for **${targetHeading}** (${bundle.chapterTitle}):`);
      } else if (reasoning.isSummaryRequest) {
        parts.push(`### Chapter Overview: ${bundle.chapterTitle} (${bundle.subject})`);
        if (bundle.syllabusTopics.length > 0) {
          parts.push(`**Official Syllabus Topics:**\n` + bundle.syllabusTopics.map((t, idx) => `${idx + 1}. **${t}**`).join('\n'));
        }
      } else {
        parts.push(`### ${targetHeading} — ${bundle.chapterTitle}`);
      }

      if (evidence.foundInChapterFiles && evidence.unifiedContext.activeChapterEvidence.length > 0) {
        const primary = evidence.unifiedContext.activeChapterEvidence[0];
        const primaryPageLabel = formatPageProvenanceLabel(primary.pageNumber, primary.pageEnd);
        parts.push(
          `**From Your Chapter Notes ([${primary.documentTitle}, ${primaryPageLabel}]):**\n${primary.content}`
        );
        if (evidence.unifiedContext.activeChapterEvidence.length > 1) {
          const secondary = evidence.unifiedContext.activeChapterEvidence[1];
          if (secondary.id !== primary.id && !String(secondary.id).startsWith('item_')) {
            const secondaryPageLabel = formatPageProvenanceLabel(secondary.pageNumber, secondary.pageEnd);
            parts.push(
              `**Additional Point ([${secondary.documentTitle}, ${secondaryPageLabel}]):**\n${secondary.content}`
            );
          }
        }

        const exampleItems = evidence.topItems.filter((it) => it.itemType === 'code_example' || it.itemType === 'worked_example');
        const defItems = evidence.topItems.filter((it) => it.itemType === 'definition' || it.itemType === 'formula');

        if (defItems.length > 0 && !reasoning.isExampleFollowUp) {
          const defPageLabel = formatPageProvenanceLabel(defItems[0].pageStart, defItems[0].pageEnd);
          parts.push(
            `**Key Definition / Formula ([${defItems[0].fileTitle}, ${defPageLabel}]):**\n> ${defItems[0].contentText}`
          );
        }

        if (exampleItems.length > 0) {
          const langGuess = /\b(?:html|css|js|javascript|php|sql|python|java|c)\b/i.exec(bundle.subject)?.[0]?.toLowerCase() || 'css';
          const exPageLabel = formatPageProvenanceLabel(exampleItems[0].pageStart, exampleItems[0].pageEnd);
          parts.push(
            `**Worked / Code Example ([${exampleItems[0].fileTitle}, ${exPageLabel}]):**\n\`\`\`${langGuess}\n${exampleItems[0].contentText}\n\`\`\``
          );
        } else if (reasoning.isExampleFollowUp || reasoning.isConfusionFollowUp) {
          parts.push(
            `**Step-by-Step Example (AI Tutor Supplement):**\nSuppose we are applying **${targetHeading}** in practice:\n1. Identify the target element or input.\n2. Apply the core rule or syntax for **${targetHeading}**.\n3. Verify the output behavior against the ${bundle.subject} specification.`
          );
        }
      }

      if (evidence.foundInSameSubjectPrerequisites && evidence.unifiedContext.sameSubjectSupplementaryEvidence.length > 0) {
        for (const pre of evidence.unifiedContext.sameSubjectSupplementaryEvidence.slice(0, 2)) {
          const prePageLabel = formatPageProvenanceLabel(pre.pageNumber, pre.pageEnd);
          parts.push(
            `**Prerequisite / Supporting Concept from Earlier Chapter in ${bundle.subject} ([${pre.documentTitle} — ${pre.chapter}, ${prePageLabel}]):**\n${pre.content}`
          );
        }
      }

      if (!evidence.foundInChapterFiles) {
        parts.push(
          `*Note: **${targetHeading}** is not explicitly detailed in the uploaded PDF notes for ${bundle.chapterTitle}${evidence.foundInSameSubjectPrerequisites ? ' (supporting prerequisite notes from another chapter of ' + bundle.subject + ' are shown above)' : ''}, so here is a complete supplementary explanation from Kyana AI's academic knowledge aligned with your **${bundle.subject}** syllabus:*`
        );
        parts.push(
          `**Supplementary Academic Explanation (Curriculum-Aligned):**\n**${targetHeading}** is an essential concept in **${bundle.subject}** (${bundle.chapterTitle}). It defines how components, rules, or operations are structured and executed so you can solve both theoretical and practical university exam problems.`
        );
        parts.push(
          `**Practical Example:**\n- **Scenario:** Applying **${targetHeading}** in a real **${bundle.subject}** problem.\n- **How it works:** First define the structure/inputs, apply the governing rule for **${targetHeading}**, and observe the resulting state or output.`
        );
        if (bundle.syllabusTopics.length > 0) {
          parts.push(
            `**Related Chapter Syllabus Topics:** ${bundle.syllabusTopics.slice(0, 6).join(' · ')}`
          );
        }
      }

      if (evidence.foundPyqQuestions && !reasoning.isSummaryRequest) {
        const topPyq = evidence.pyqQuestions[0];
        parts.push(
          `**Past Exam Connection (PYQ):** This topic appeared in **${topPyq.examYear} ${topPyq.examType} (Q.${topPyq.questionNumber}, ${topPyq.marks} Marks)** — *"${topPyq.content}"* (Asked ${evidence.pyqAnalytics.timesAsked}× in ${evidence.pyqAnalytics.examYears.join(', ')}).`
        );
      }

      replyText = parts.join('\n\n');
    } else if (evidence.foundInSameSubjectPrerequisites && !replyText.includes('Prerequisite / Supporting Concept')) {
      const pre = evidence.unifiedContext.sameSubjectSupplementaryEvidence[0];
      const prePageLabel = formatPageProvenanceLabel(pre.pageNumber, pre.pageEnd);
      replyText += `\n\n**Prerequisite / Supporting Concept from Earlier Chapter in ${bundle.subject} ([${pre.documentTitle} — ${pre.chapter}, ${prePageLabel}]):**\n${pre.content}`;
    }
  }

  if (conflictResult.hasConflict) {
    const conflictNotices = conflictResult.conflicts.map((c) => c.formattedNotice).join('\n\n');
    if (!replyText.includes('Academic Note — Multiple Source Perspectives')) {
      replyText += `\n\n${conflictNotices}`;
    }
  }

  replyText = sanitizeAdaptiveResponse(replyText);

  const citations = [
    ...evidence.unifiedContext.activeChapterEvidence.map((ch) => ({
      fileId: ch.fileId,
      fileTitle: ch.documentTitle,
      chapter: ch.chapter,
      pageStart: ch.pageNumber,
      pageEnd: ch.pageEnd || ch.pageNumber,
      pageLabel: formatPageProvenanceLabel(ch.pageNumber, ch.pageEnd),
      sectionHeading: ch.sectionHeading,
      evidenceOrigin: 'active_chapter'
    })),
    ...evidence.unifiedContext.sameSubjectSupplementaryEvidence.map((pre) => ({
      fileId: pre.fileId,
      fileTitle: pre.documentTitle,
      chapter: pre.chapter,
      pageStart: pre.pageNumber,
      pageEnd: pre.pageEnd || pre.pageNumber,
      pageLabel: formatPageProvenanceLabel(pre.pageNumber, pre.pageEnd),
      sectionHeading: pre.sectionHeading,
      evidenceOrigin: 'same_subject_prerequisite'
    }))
  ];

  if (actualVisualAssetsUsed && actualVisualAssetsUsed.length > 0 && !visualProcessingFailed) {
    for (const va of actualVisualAssetsUsed) {
      const alreadyCited = citations.some(
        (c) => String(c.fileId) === String(va.fileId) &&
               Number(c.pageStart) === Number(va.pageNumber || 1) &&
               c.evidenceOrigin === 'visual_evidence'
      );
      if (!alreadyCited) {
        citations.push({
          fileId: va.fileId,
          fileTitle: va.fileTitle,
          chapter: bundle.chapterTitle,
          pageStart: va.pageNumber || 1,
          pageEnd: va.pageNumber || 1,
          pageLabel: formatPageProvenanceLabel(va.pageNumber || 1, va.pageNumber || 1),
          sectionHeading: va.title || 'Visual Evidence',
          evidenceOrigin: 'visual_evidence'
        });
      }
    }
  }

  const resourceCards = (bundle.files || []).slice(0, 4).map((f) => ({
    type: 'note',
    id: f.id,
    title: f.title,
    subject: bundle.subject,
    semester: bundle.semesterNo,
    chapter: bundle.chapterTitle,
    action: 'open_note',
    deepLink: `/material/${f.id}`,
    viewUrl: f.viewUrl,
    downloadUrl: f.downloadUrl
  }));

  const chapterTutorMeta = {
    foundInNotes: Boolean(evidence.foundInChapterFiles),
    foundInSameSubjectPrerequisites: Boolean(evidence.foundInSameSubjectPrerequisites),
    foundPyqQuestions: Boolean(evidence.foundPyqQuestions),
    targetPyqQuestion: evidence.targetPyqQuestion || null,
    pyqClarificationNeeded: Boolean(evidence.pyqClarificationNeeded),
    hasAcademicConflict: Boolean(conflictResult.hasConflict),
    academicConflicts: conflictResult.conflicts || [],
    conflictDetails: conflictResult.details || [],
    usedFallbackKnowledge: !evidence.foundInChapterFiles,
    resolvedTopic: reasoning.resolvedTopicQuery || reasoning.originalQuestion,
    isFollowUp: Boolean(reasoning.isFollowUp),
    isConfusionFollowUp: Boolean(reasoning.isConfusionFollowUp),
    wantsExample: Boolean(reasoning.isExampleFollowUp),
    isExamOrPyqQuery: Boolean(reasoning.isQuestionPracticeRequest),
    isPyqSolveRequest: Boolean(reasoning.isPyqSolveRequest),
    presentationProfile: presentationPlan.profile,
    allowedComponents: presentationPlan.allowedComponents,
    forbiddenComponents: presentationPlan.forbiddenComponents,
    budgetStats: evidence.unifiedContext.budgetStats,
    visualEvidenceUsed: Boolean(actualVisualAssetsUsed && actualVisualAssetsUsed.length > 0 && !visualProcessingFailed),
    visualAssets: (actualVisualAssetsUsed && !visualProcessingFailed)
      ? actualVisualAssetsUsed.map((va) => ({
          fileId: va.fileId,
          fileTitle: va.fileTitle,
          pageNumber: va.pageNumber || 1,
          mimeType: va.mimeType,
          title: va.title,
          description: va.description,
          score: va.score,
          kind: va.kind || 'image_material'
        }))
      : [],
    diagramDescriptionsUsed: Boolean(diagramDescriptionsAvailable && (!actualVisualAssetsUsed || actualVisualAssetsUsed.length === 0)),
    visualProcessingFailed: Boolean(visualProcessingFailed),
    visualFallbackTextOnly: Boolean(visualFallbackTextOnly)
  };

  return {
    delegateToStudyPartner: false,
    mode: 'chapter_qa',
    intent: 'chapter_tutor',
    presentationPlan,
    reply: replyText,
    bundle,
    reasoning,
    foundInChapterFiles: evidence.foundInChapterFiles,
    foundInSameSubjectPrerequisites: evidence.foundInSameSubjectPrerequisites,
    foundPyqQuestions: evidence.foundPyqQuestions,
    evidenceContext: evidence.unifiedContext,
    pyqIntelligence: {
      questions: evidence.pyqQuestions,
      analytics: evidence.pyqAnalytics
    },
    chapterTutor: chapterTutorMeta,
    citations,
    resourceCards
  };
}

module.exports = {
  DEFAULT_MAX_CONTEXT_TOKENS,
  extractUnitNumberFromChapter,
  classifyReaderFileType,
  getChapterReaderBundle,
  detectSameSubjectPrerequisiteTargets,
  analyzeChapterStudentQuestion,
  buildUnifiedChapterEvidenceContext,
  retrieveChapterEvidence,
  answerWithChapterContext,
  findTargetPyqQuestion,
  formatPyqStepByStepSolution,
  formatPyqClarificationResponse,
  formatPageProvenanceLabel,
  retrieveChapterVisualAssets,
  hasDiagramDescriptions
};
