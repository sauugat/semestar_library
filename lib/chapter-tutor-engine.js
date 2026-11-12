'use strict';

/**
 * KAIE Chapter Tutor & Continuous Chapter Reader Engine
 *
 * Powers the Library Split-Screen Workspace:
 * - Left Pane: Continuous multi-PDF/note reader bundle (ordered chapter files + extracted pages + syllabus topics)
 * - Right Pane: Chapter-scoped Kyana AI Chatbot with a 4-stage reasoning pipeline:
 *   1. THINK / INTENT & FOLLOW-UP RESOLUTION: Understands what the student is asking, resolves conversational
 *      follow-ups ("I don't understand", "give me an example", "explain again") against prior chat turns, and
 *      distinguishes between explicit step-by-step chapter teaching ("teach me this chapter") vs. targeted Q&A.
 *   2. RETRIEVE CHAPTER NOTES & SYLLABUS: Searches all PDFs/notes belonging to the active chapter (`fileIds` +
 *      `document_chunks` + `academic_extracted_items` + `document_pages`) and the official chapter syllabus.
 *   3. TEACH / ANSWER WITH CITATIONS: Teaches or answers the student's question grounded in the chapter's
 *      uploaded notes (citing `[File Title, Page X]`) and official syllabus points.
 *   4. LLM KNOWLEDGE FALLBACK: If the asked topic/subtopic or requested example is not present in the uploaded
 *      chapter files, seamlessly supplements with LLM academic knowledge so the student is never left stuck.
 */

const path = require('path');
const { ensureRagSchema } = require('./rag-schema');
const {
  normalizeText,
  parseSemesterNumber
} = require('./academic-document-understanding');
const {
  resolveCourseAndChapter,
  computeTopicSimilarity
} = require('./study-partner-reconciler');
const { canReadResource } = require('./kyana-access');
const {
  planAdaptivePresentation,
  buildAdaptivePresentationPrompt,
  buildAdaptiveEducationalFallback,
  sanitizeAdaptiveResponse
} = require('./adaptive-presentation-engine');

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
  const academicContext = options.academicContext || null;

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

  // Fetch files belonging to this chapter
  let fileRows = [];
  if (requestedFileIds.length > 0) {
    const placeholders = requestedFileIds.map(() => '?').join(',');
    const fetched = await db.all(
      `SELECT id, storedName, originalName, title, semester, semester_no, subject, chapter,
              uploadedBy, sizeBytes, uploadedAt, previewName, cohort_id, audience_scope,
              resource_category, unit_number, COALESCE(sort_order, 0) AS sort_order
       FROM files
       WHERE id IN (${placeholders})`,
      ...requestedFileIds
    ).catch(() => []);
    const byId = new Map((fetched || []).map((f) => [Number(f.id), f]));
    fileRows = requestedFileIds.map((id) => byId.get(id)).filter(Boolean);
  } else if (rawSubject) {
    const allSubjectFiles = await db.all(
      `SELECT id, storedName, originalName, title, semester, semester_no, subject, chapter,
              uploadedBy, sizeBytes, uploadedAt, previewName, cohort_id, audience_scope,
              resource_category, unit_number, COALESCE(sort_order, 0) AS sort_order
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

  // Enforce cohort / semester access
  if (academicContext && typeof canReadResource === 'function') {
    fileRows = fileRows.filter((f) => canReadResource(academicContext, f, 'note', { allowCrossSemester: true }));
  }

  fileRows = sortChapterFilesNaturally(fileRows);

  // Fetch extracted pages and structured items for each file in the chapter
  const chapterFiles = [];
  for (let i = 0; i < fileRows.length; i++) {
    const f = fileRows[i];
    const fileIdStr = String(f.id);
    const [pages, items, chunks] = await Promise.all([
      db.all(
        `SELECT page_number, cleaned_text, raw_text, has_OCR
         FROM document_pages
         WHERE ${db.isPostgres ? 'CAST(file_id AS TEXT) = ?' : '(CAST(file_id AS TEXT) = ? OR CAST(file_id AS INTEGER) = ?)'}
         ORDER BY page_number ASC`,
        ...(db.isPostgres ? [fileIdStr] : [fileIdStr, Number(f.id)])
      ).catch(() => []),
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

    const normalizedPages = (pages || []).map((p) => ({
      pageNumber: Number(p.page_number ?? p.pageNumber ?? 1),
      text: String(p.cleaned_text || p.cleanedText || p.raw_text || p.rawText || '').trim(),
      hasOcr: Boolean(p.has_OCR ?? p.hasOcr)
    })).filter((p) => p.text.length > 0);

    // If document_pages is empty but chunks exist, synthesize page views from chunks
    if (normalizedPages.length === 0 && Array.isArray(chunks) && chunks.length > 0) {
      const byPage = new Map();
      for (const ch of chunks) {
        const pNum = Number(ch.page_start ?? ch.pageStart ?? 1);
        if (!byPage.has(pNum)) byPage.set(pNum, []);
        byPage.get(pNum).push(String(ch.clean_content || ch.cleanContent || '').trim());
      }
      for (const [pNum, texts] of Array.from(byPage.entries()).sort((a, b) => a[0] - b[0])) {
        const joined = texts.filter(Boolean).join('\n\n');
        if (joined) normalizedPages.push({ pageNumber: pNum, text: joined, hasOcr: false });
      }
    }

    const readerType = classifyReaderFileType(f);
    chapterFiles.push({
      orderIndex: i + 1,
      id: Number(f.id),
      title: f.title || f.originalName || `Note ${i + 1}`,
      originalName: f.originalName || f.original_name || '',
      readerType,
      viewUrl: `/api/files/${f.id}/view`,
      downloadUrl: `/api/files/${f.id}/download`,
      sizeBytes: Number(f.sizeBytes || f.size_bytes || 0),
      resourceCategory: f.resource_category || f.resourceCategory || 'notes',
      pageCount: normalizedPages.length,
      pages: normalizedPages,
      extractedItemsCount: (items || []).length,
      extractedItems: (items || []).slice(0, 30).map((it) => ({
        id: it.id,
        itemType: it.item_type || it.itemType,
        title: it.title || it.topic,
        contentText: it.content_text || it.contentText,
        pageStart: Number(it.page_start ?? it.pageStart ?? 1),
        pageEnd: Number(it.page_end ?? it.pageEnd ?? 1)
      }))
    });
  }

  return {
    subject: course.title,
    subjectCode: course.code || 'COURSE',
    semesterNo: course.semesterNo || 1,
    unitNumber: matchedUnit ? matchedUnit.unitNumber : effectiveUnitNumber,
    chapterTitle: rawChapter || (matchedUnit ? `Unit ${matchedUnit.unitNumber}: ${matchedUnit.title}` : 'Chapter Notes'),
    unitTitle: matchedUnit ? matchedUnit.title : rawChapter,
    teachingHours: matchedUnit ? (matchedUnit.teachingHours || 0) : 0,
    syllabusTopics,
    totalFiles: chapterFiles.length,
    files: chapterFiles
  };
}

/**
 * Stage 1 of the Chapter Tutor Pipeline:
 * Analyzes the student's message + conversation history to determine:
 * - Whether the student explicitly asked to start/continue step-by-step chapter teaching ("teach me this chapter")
 * - Whether the student is asking a conversational follow-up ("I don't understand", "give me an example", "explain again")
 * - What concrete topic/concept the student needs taught or answered
 */
function analyzeChapterStudentQuestion(message = '', history = [], syllabusTopics = []) {
  const cleanMsg = String(message || '').trim();
  const lower = cleanMsg.toLowerCase();

  // 1. Explicit request to teach the whole chapter step-by-step
  const isExplicitChapterTeachRequest =
    /\b(?:teach\s+me\s+(?:this|the)\s+(?:chapter|unit|topic|lesson)|start\s+teaching(?:\s+this\s+chapter)?|teach\s+(?:this|full|whole)\s+(?:chapter|unit)(?:\s+step\s+by\s+step)?|teach\s+me\s+step\s+by\s+step|teach\s+me\s+from\s+(?:the\s+)?(?:beginning|start|scratch)|yo\s+(?:chapter|unit)\s+(?:padhaideu|padhau|sikaideu|bujhaideu)|chapter\s+suru\s+gara)\b/i.test(cleanMsg) ||
    /^(?:teach\s+me|start\s+lesson|teach\s+this\s+unit|step\s+by\s+step\s+teach)[.!?]*$/i.test(cleanMsg);

  // 2. Follow-up detection ("I don't understand", "give me an example", "simplify", "why?", "show code", etc.)
  const isConfusionFollowUp =
    /\b(?:i\s+(?:don'?t|do\s+not|didn'?t)\s+understand|confused|still\s+not\s+clear|not\s+clear|explain\s+(?:again|more|simply|in\s+simple\s+words|better)|simplify|bujhina|bujhena|ali\s+sajilo|feri\s+bujhaideu|ramrari\s+bujhaideu|kasto\s+ho\s+yo)\b/i.test(cleanMsg);

  const isExampleFollowUp =
    /\b(?:give\s+(?:me\s+)?(?:an?\s+|another\s+|more\s+|some\s+)?(?:(?:\w+\s+){0,2})?examples?|show\s+(?:me\s+)?(?:an?\s+)?(?:(?:\w+\s+){0,2})?(?:example|code|demo|program)|with\s+(?:an?\s+)?example|real\s+(?:life|world)\s+example|udaharan|example\s+deu|code\s+deu)\b/i.test(cleanMsg);

  const isQuestionPracticeRequest =
    /\b(?:model\s+questions?|exam\s+questions?|important\s+questions?|practice\s+questions?|pyqs?|ask\s+me\s+a?\s*questions?|quiz\s+me|test\s+me)\b/i.test(cleanMsg);

  const isSummaryRequest =
    /\b(?:summarize|summary|overview|key\s+points?|main\s+topics?|what\s+is\s+in\s+this\s+chapter|all\s+notes\s+summary)\b/i.test(cleanMsg);

  const isShortFollowUp =
    isConfusionFollowUp ||
    isExampleFollowUp ||
    /^(?:why|how|what\s+about\s+it|and\s+then|what\s+does\s+that\s+mean|elaborate|more\s+details?|tell\s+me\s+more)[?.!]*$/i.test(cleanMsg);

  // Extract previous topic from conversation history when this is a follow-up
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

  // Determine the target topic to look up in the chapter PDFs & syllabus
  let resolvedTopicQuery = cleanMsg;
  if (isShortFollowUp && (lastUserQuestion || priorTopic)) {
    // Strip generic follow-up words from current message and combine with prior topic
    const specificTermsInCurrent = cleanMsg
      .replace(/\b(?:i\s+(?:don'?t|do\s+not|didn'?t)\s+understand|give\s+me\s+(?:an?\s+|another\s+|more\s+)?(?:practical\s+|simple\s+|real\s+|code\s+)?examples?(?:\s+of)?|can\s+you\s+explain|explain\s+again|please|now|can\s+you|show\s+me|bujhina|feri|[?,!.])\b/gi, '')
      .trim();
    resolvedTopicQuery = specificTermsInCurrent.length >= 4
      ? `${specificTermsInCurrent} ${priorTopic || lastUserQuestion}`.trim()
      : (lastUserQuestion || priorTopic || cleanMsg);
  }

  // Also check if the query matches any official syllabus topic in this chapter
  let matchedSyllabusTopic = null;
  let bestSylScore = 0;
  const normQuery = normalizeText(resolvedTopicQuery);
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

  return {
    originalQuestion: cleanMsg,
    resolvedTopicQuery,
    matchedSyllabusTopic: bestSylScore >= 0.42 ? matchedSyllabusTopic : null,
    isExplicitChapterTeachRequest,
    isConfusionFollowUp,
    isExampleFollowUp,
    isQuestionPracticeRequest,
    isSummaryRequest,
    isFollowUp: Boolean(isShortFollowUp && (lastUserQuestion || lastAssistantMessage)),
    lastUserQuestion,
    lastAssistantMessage: lastAssistantMessage ? lastAssistantMessage.slice(0, 1200) : ''
  };
}

/**
 * Stage 2 of the Chapter Tutor Pipeline:
 * Searches the chapter's uploaded PDFs/notes (`document_chunks`, `academic_extracted_items`, `document_pages`)
 * and syllabus for the resolved topic.
 */
async function retrieveChapterEvidence(db, bundle, reasoning) {
  const fileIds = (bundle.files || []).map((f) => f.id);
  const queryText = reasoning.resolvedTopicQuery || reasoning.originalQuestion || '';
  const normQuery = normalizeText(queryText);

  const stopWords = new Set([
    'what', 'is', 'are', 'the', 'in', 'of', 'to', 'and', 'for', 'how', 'why', 'explain',
    'define', 'tell', 'me', 'about', 'can', 'you', 'give', 'example', 'examples', 'this',
    'chapter', 'unit', 'notes', 'pdf', 'from', 'with', 'understand', 'dont', 'please'
  ]);
  const queryTokens = normQuery
    .split(/\s+/)
    .map((w) => w.replace(/(?:es|s|ing|ed)$/, ''))
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const matchedChunks = [];
  const matchedItems = [];

  if (fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    const fileFilterSql = db.isPostgres
      ? `CAST(c.file_id AS INTEGER) IN (${placeholders})`
      : `(CAST(c.file_id AS INTEGER) IN (${placeholders}) OR c.file_id IN (${placeholders.split(',').map(() => '?').join(',')}))`;
    const fileFilterParams = db.isPostgres
      ? [...fileIds]
      : [...fileIds, ...fileIds.map(String)];

    const allChapterChunks = await db.all(
      `SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end, c.section_heading, c.clean_content,
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

      let score = 0;
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

      if (reasoning.isSummaryRequest && score === 0) {
        score = 0.5;
      }

      if (score > 0) {
        matchedChunks.push({
          id: ch.id,
          fileId: Number(ch.file_id ?? ch.fileId),
          fileTitle: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName || 'Chapter Note',
          pageStart: Number(ch.page_start ?? ch.pageStart ?? 1),
          pageEnd: Number(ch.page_end ?? ch.pageEnd ?? 1),
          sectionHeading: ch.section_heading || ch.sectionHeading || '',
          content: String(ch.clean_content || ch.cleanContent || '').trim(),
          score
        });
      }
    }

    // Also fallback to searching `bundle.files[].pages` if `document_chunks` had no rows
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
              pageStart: p.pageNumber,
              pageEnd: p.pageNumber,
              sectionHeading: f.title,
              content: p.text.slice(0, 900),
              score
            });
          }
        }
      }
    }

    // Score extracted items (definitions, formulas, examples, inline questions)
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
            score
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

  return {
    foundInChapterFiles,
    topChunks,
    topItems,
    allFilesSummary: (bundle.files || []).map((f) => ({
      id: f.id,
      title: f.title,
      pageCount: f.pageCount,
      firstPageExcerpt: f.pages?.[0]?.text ? f.pages[0].text.slice(0, 350) : ''
    }))
  };
}

/**
 * Stage 3 & 4 of the Chapter Tutor Pipeline:
 * Builds the LLM prompt & deterministic fallback so Kyana:
 * 1. Thinks about what the student is asking (including resolving follow-ups from history),
 * 2. Grounds the explanation in the chapter's uploaded PDFs (with `[File Title, Page X]` citations) and syllabus,
 * 3. Falls back to LLM academic knowledge if the topic or example is not in the uploaded PDFs.
 */
async function answerWithChapterContext(db, options = {}) {
  const {
    message,
    history = [],
    chapterContext = {},
    academicContext = null,
    generateReplyFn = null,
    signal
  } = options;

  const bundle = await getChapterReaderBundle(db, {
    subject: chapterContext.subject,
    subjectCode: chapterContext.subjectCode,
    semesterNo: chapterContext.semesterNo,
    unitNumber: chapterContext.unitNumber,
    chapterTitle: chapterContext.chapterTitle || chapterContext.chapter,
    fileIds: chapterContext.fileIds,
    academicContext
  });

  const reasoning = analyzeChapterStudentQuestion(message, history, bundle.syllabusTopics);

  // If the student explicitly says "teach me this chapter" (or similar), delegate to Study Partner step-by-step mode!
  if (reasoning.isExplicitChapterTeachRequest) {
    return {
      delegateToStudyPartner: true,
      bundle,
      reasoning
    };
  }

  const evidence = await retrieveChapterEvidence(db, bundle, reasoning);
  const presentationPlan = planAdaptivePresentation(reasoning.resolvedTopicQuery || reasoning.originalQuestion, {
    foundInChapterFiles: evidence.foundInChapterFiles,
    hasPyq: reasoning.isQuestionPracticeRequest
  });

  const syllabusListText = bundle.syllabusTopics.length > 0
    ? bundle.syllabusTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : 'Official syllabus topics for this chapter.';

  const pdfEvidenceBlocks = evidence.topChunks.map((ch, idx) =>
    `[PDF Source ${idx + 1}: "${ch.fileTitle}" | Page ${ch.pageStart}${ch.pageEnd > ch.pageStart ? `-${ch.pageEnd}` : ''}${ch.sectionHeading ? ` | Section: ${ch.sectionHeading}` : ''}]\n${ch.content}`
  ).join('\n\n');

  const extractedItemsBlocks = evidence.topItems.map((it) =>
    `[${String(it.itemType || 'item').toUpperCase()} from "${it.fileTitle}" (Page ${it.pageStart}) — ${it.title || 'Concept'}]:\n${it.contentText}`
  ).join('\n\n');

  const systemPrompt = [
    `You are Kyana AI, the intelligent Chapter Study Partner for Gandaki University BIT students.`,
    `You are currently inside the Split-Screen Chapter Workspace for:`,
    `- Course: ${bundle.subject} (${bundle.subjectCode}, Semester ${bundle.semesterNo})`,
    `- Active Chapter: ${bundle.chapterTitle}`,
    `- Uploaded Chapter Files (${bundle.totalFiles}): ${(bundle.files || []).map((f) => `"${f.title}"`).join(', ') || 'None uploaded yet'}`,
    ``,
    buildAdaptivePresentationPrompt(presentationPlan),
    ``,
    `HOW YOU MUST REASON AND TEACH:`,
    `1. THINK FIRST: Understand the student's exact intent.`,
    `   - Student's raw message: "${reasoning.originalQuestion}"`,
    `   - Resolved topic/intent: "${reasoning.resolvedTopicQuery}"`,
    reasoning.isFollowUp
      ? `   - CONVERSATIONAL FOLLOW-UP DETECTED: The student is following up on the previous turn ("${reasoning.lastUserQuestion || reasoning.lastAssistantMessage.slice(0, 140)}"). Address their confusion or request for an example directly without losing context!`
      : `   - Direct question or topic inquiry.`,
    `2. CHECK CHAPTER PDFs & SYLLABUS:`,
    `   - Official Chapter Syllabus Subtopics:\n${syllabusListText}`,
    evidence.foundInChapterFiles
      ? `   - MATCHING EVIDENCE FOUND IN CHAPTER PDFs:\n${pdfEvidenceBlocks}\n\n${extractedItemsBlocks}`
      : `   - NOTE COVERAGE STATUS: This specific topic/question was NOT found verbatim in the uploaded chapter PDFs (or no PDFs cover it yet).\n   - Chapter files overview: ${(evidence.allFilesSummary || []).map((f) => `${f.title} (${f.pageCount} pages)`).join(', ') || 'No files uploaded'}`,
    `3. TEACH & ANSWER CLEARLY:`,
    evidence.foundInChapterFiles
      ? `   - Answer and teach the concept using the uploaded chapter PDF notes above AND the chapter syllabus. Cite the specific note title and page number naturally (e.g., *(Ref: ${evidence.topChunks[0]?.fileTitle || bundle.files[0]?.title || 'Chapter Notes'}, Page ${evidence.topChunks[0]?.pageStart || 1})*).`
      : `   - Since this topic/detail is not covered in the uploaded chapter PDFs, state briefly in 1 friendly clause that it isn't covered in the uploaded chapter PDFs and then TEACH IT THOROUGHLY using your own academic knowledge aligned with the ${bundle.subject} syllabus! Never refuse or leave the student without a complete answer.`,
    reasoning.isConfusionFollowUp
      ? `   - Because the student said they didn't understand, break the concept down in much simpler, beginner-friendly step-by-step language with a relatable analogy and a concrete example.`
      : '',
    reasoning.isExampleFollowUp
      ? `   - Provide a clear, practical worked example or clean code snippet illustrating the concept step by step.`
      : '',
    `   - Do NOT force a rigid checkpoint lock unless the student asks you to teach the whole chapter step-by-step.`
  ].filter(Boolean).join('\n');

  let replyText = '';
  if (typeof generateReplyFn === 'function') {
    try {
      const llmOut = await generateReplyFn({
        message: reasoning.originalQuestion,
        history,
        systemPrompt,
        tools: [],
        onDelta: () => {},
        signal,
        complex: false
      });
      replyText = String(llmOut?.reply || '').trim();
    } catch (_) {}
  }

  // Deterministic, high-clarity fallback when no external LLM key is configured or in offline tests
  if (!replyText) {
    const specializedAdaptiveFallback = !reasoning.isFollowUp && !reasoning.isSummaryRequest && !evidence.foundInChapterFiles
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
      ['truth_table', 'interactive_simulation', 'mathematical_derivation'].includes(presentationPlan.profile) &&
      !reasoning.isFollowUp
    ) {
      replyText = buildAdaptiveEducationalFallback(reasoning.originalQuestion, {
        plan: presentationPlan,
        bundle,
        evidence,
        reasoning
      });
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

      if (evidence.foundInChapterFiles) {
        if (evidence.topChunks.length > 0) {
          const primary = evidence.topChunks[0];
          parts.push(
            `**From Your Chapter Notes ([${primary.fileTitle}, Page ${primary.pageStart}]):**\n${primary.content}`
          );
          if (evidence.topChunks.length > 1) {
            const secondary = evidence.topChunks[1];
            parts.push(
              `**Additional Point ([${secondary.fileTitle}, Page ${secondary.pageStart}]):**\n${secondary.content}`
            );
          }
        }

        const exampleItems = evidence.topItems.filter((it) => it.itemType === 'code_example' || it.itemType === 'worked_example');
        const defItems = evidence.topItems.filter((it) => it.itemType === 'definition' || it.itemType === 'formula');

        if (defItems.length > 0 && !reasoning.isExampleFollowUp) {
          parts.push(
            `**Key Definition / Formula ([${defItems[0].fileTitle}, Page ${defItems[0].pageStart}]):**\n> ${defItems[0].contentText}`
          );
        }

        if (exampleItems.length > 0) {
          const langGuess = /\b(?:html|css|js|javascript|php|sql|python|java|c)\b/i.exec(bundle.subject)?.[0]?.toLowerCase() || 'css';
          parts.push(
            `**Worked / Code Example ([${exampleItems[0].fileTitle}, Page ${exampleItems[0].pageStart}]):**\n\`\`\`${langGuess}\n${exampleItems[0].contentText}\n\`\`\``
          );
        } else if (reasoning.isExampleFollowUp || reasoning.isConfusionFollowUp) {
          parts.push(
            `**Step-by-Step Example (AI Tutor Supplement):**\nSuppose we are applying **${targetHeading}** in practice:\n1. Identify the target element or input.\n2. Apply the core rule or syntax for **${targetHeading}**.\n3. Verify the output behavior against the ${bundle.subject} specification.`
          );
        }
      } else {
        parts.push(
          `*Note: **${targetHeading}** is not explicitly detailed in the uploaded PDF notes for ${bundle.chapterTitle}, so here is a complete explanation from Kyana AI's academic knowledge aligned with your **${bundle.subject}** syllabus:*`
        );
        parts.push(
          `**Core Concept:**\n**${targetHeading}** is an essential concept in **${bundle.subject}** (${bundle.chapterTitle}). It defines how components, rules, or operations are structured and executed so you can solve both theoretical and practical university exam problems.`
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

      replyText = parts.join('\n\n');
    }
  }

  replyText = sanitizeAdaptiveResponse(replyText);

  const citations = evidence.topChunks.map((ch) => ({
    fileId: ch.fileId,
    fileTitle: ch.fileTitle,
    pageStart: ch.pageStart,
    pageEnd: ch.pageEnd,
    sectionHeading: ch.sectionHeading
  }));

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
    usedFallbackKnowledge: !evidence.foundInChapterFiles,
    resolvedTopic: reasoning.resolvedTopicQuery || reasoning.originalQuestion,
    isFollowUp: Boolean(reasoning.isFollowUp),
    isConfusionFollowUp: Boolean(reasoning.isConfusionFollowUp),
    wantsExample: Boolean(reasoning.isExampleFollowUp),
    presentationProfile: presentationPlan.profile,
    allowedComponents: presentationPlan.allowedComponents,
    forbiddenComponents: presentationPlan.forbiddenComponents
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
    chapterTutor: chapterTutorMeta,
    citations,
    resourceCards
  };
}

module.exports = {
  extractUnitNumberFromChapter,
  classifyReaderFileType,
  getChapterReaderBundle,
  analyzeChapterStudentQuestion,
  retrieveChapterEvidence,
  answerWithChapterContext
};
