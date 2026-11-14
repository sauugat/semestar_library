'use strict';

/**
 * KAIE Phase 2 & 3: Syllabus-First Course Map, Multi-Document Knowledge Graph Consolidation,
 * Uncertain Mapping Review Queue & Cross-File Conflict Detection Engine
 */

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const {
  normalizeText,
  parseSemesterNumber
} = require('./academic-document-understanding');
const {
  resolveCourseAndChapter,
  computeTopicSimilarity
} = require('./study-partner-reconciler');
const { searchPyqQuestions } = require('./pyq-intelligence');

function makeDeterministicId(prefix, key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 20);
  return `${prefix}_${hash}`;
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function isGenericHeading(heading) {
  const clean = String(heading || '').trim();
  if (!clean || clean.length < 3 || clean.length > 110) return true;
  if (/^\d+$/.test(clean)) return true;
  if (/^(?:page|pg\.?|slide|sheet|unit|chapter|ch\.?|module|part|section|sec\.?|figure|fig\.?|table)\s*\d*$/i.test(clean)) return true;
  if (/^(?:table\s+of\s+contents|contents|index|references?|bibliography|appendix|acknowledg?ments?|preface|overview|summary|untitled|notes?|syllabus)$/i.test(clean)) return true;
  return false;
}

function cleanSyllabusTopicText(rawTopic) {
  let topic = String(rawTopic || '').trim();
  if (!topic) return null;
  topic = topic.replace(/\s+After completing\b[\s\S]*$/i, '').trim();
  topic = topic.replace(/\s+After completion of\b[\s\S]*$/i, '').trim();
  topic = topic.replace(/\s+\[?\(?\d+\s*(?:hrs?|hours?)\)?\]?$/i, '').trim();
  if (!topic || topic.length < 2) return null;
  if (/^(?:after completing|after completion|students will|program with different|at the end of|learning outcomes?:|objectives?:|textbooks?:|references?:|laboratory works?:)/i.test(topic)) {
    return null;
  }
  if (/should be developed\.?$/i.test(topic)) {
    return null;
  }
  return topic;
}

/**
 * Parses raw text from an uploaded syllabus document into structured units & subtopics.
 */
function parseUploadedSyllabusText(rawText) {
  const text = String(rawText || '').replace(/\r/g, '');
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const units = [];
  let currentUnit = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/^#{1,6}\s+/, '').trim();
    if (!line) continue;

    if (/^(?:text\s*books?|reference\s*books?|references|laboratory\s*works?|evaluation\s*scheme)\s*:?$/i.test(line)) {
      break;
    }

    const explicitUnitMatch = line.match(/^(?:unit|chapter|module)\s*(\d{1,2})\s*[:.\-–—]?\s*([A-Za-z][^\n]*?)(?:\s+\[?\(?(\d{1,2})\s*(?:hrs?|hours?)\)?\]?)?$/i);
    const numberedUnitMatch = !explicitUnitMatch && !line.match(/^\d+\.\d+/)
      ? line.match(/^(\d{1,2})\.\s+([A-Za-z][^\n]*?)(?:\s+\[?\(?(\d{1,2})\s*(?:hrs?|hours?)\)?\]?)?$/i)
      : null;

    const match = explicitUnitMatch || numberedUnitMatch;
    if (match) {
      const unitNumber = Number(match[1]);
      let unitTitle = String(match[2] || '').trim();
      let hours = match[3] ? Number(match[3]) : 0;
      const trailingHrs = unitTitle.match(/\s+\[?\(?(\d{1,2})\s*(?:hrs?|hours?)\)?\]?$/i);
      if (trailingHrs) {
        hours = Number(trailingHrs[1]);
        unitTitle = unitTitle.slice(0, trailingHrs.index).trim();
      }
      if (unitTitle && unitNumber > 0 && unitNumber <= 30) {
        if (currentUnit) units.push(currentUnit);
        currentUnit = {
          unitNumber,
          title: unitTitle,
          teachingHours: hours || 0,
          rawLines: [],
          topics: []
        };
        continue;
      }
    }

    if (currentUnit) {
      currentUnit.rawLines.push(line);
    }
  }
  if (currentUnit) units.push(currentUnit);

  for (const unit of units) {
    const joined = unit.rawLines
      .join(' ')
      .replace(/-\s+/g, '')
      .replace(/\b\d+\.\d+(?:\.\d+)?\s*/g, '; ')
      .replace(/\b(?:[ivx]{1,4}|[a-g])\.\s+/gi, '; ');
    const parts = joined
      .split(/[;,•\n]+/)
      .map(cleanSyllabusTopicText)
      .filter((s) => s && s.length >= 2 && s.length <= 140);

    const deduped = [];
    const seen = new Set();
    for (const t of [unit.title, ...parts]) {
      const cleaned = cleanSyllabusTopicText(t);
      if (!cleaned) continue;
      const norm = normalizeText(cleaned);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      deduped.push(cleaned);
    }
    unit.topics = deduped;
  }

  return units;
}

function extractOfficialTeachingHours(course, unitNumber) {
  if (!course || !Array.isArray(course.units)) return 0;
  const u = course.units.find((item) => item.unitNumber === Number(unitNumber));
  if (!u) return 0;
  if (typeof u.teachingHours === 'number' && u.teachingHours > 0) return u.teachingHours;
  return 0;
}

function classifyChunkResourceCategory(row = {}) {
  const cat = String(row.resource_category || row.resourceCategory || '').toLowerCase().trim();
  if (cat === 'syllabus' || cat === 'practical' || cat === 'model_questions' || cat === 'reference' || cat === 'notes') {
    return cat;
  }
  const combined = `${row.file_title || row.fileTitle || ''} ${row.original_name || row.originalName || ''} ${row.chapter || ''}`.toLowerCase();
  if (/\b(?:syllabus|curriculum|course\s+outline)\b/.test(combined)) return 'syllabus';
  if (/\b(?:practical|lab|laboratory|exercise|experiment|demo)\b/.test(combined)) return 'practical';
  if (/\b(?:model\s*question|past\s*paper|pyq|question\s*paper)\b/.test(combined)) return 'model_questions';
  if (/\b(?:reference|textbook|book)\b/.test(combined)) return 'reference';
  return 'notes';
}

function inferChunkUnitNumber(row = {}, courseUnits = []) {
  const explicitUnit = Number(row.file_unit_number ?? row.fileUnitNumber ?? row.unit_number ?? row.unitNumber);
  if (Number.isInteger(explicitUnit) && explicitUnit > 0) return explicitUnit;

  const unitStr = `${row.unit || ''} ${row.chapter || ''} ${row.file_title || row.fileTitle || ''} ${row.section_heading || row.sectionHeading || ''}`;
  const m = unitStr.match(/\b(?:unit|chapter|ch\.?|module)\s*[-:.]?\s*(\d{1,2})\b/i);
  if (m) return Number(m[1]);

  const textNorm = normalizeText(`${row.section_heading || row.sectionHeading || ''} ${row.clean_content || row.cleanContent || ''}`);
  let bestUnit = null;
  let bestScore = 0;
  for (const u of courseUnits) {
    let score = 0;
    const titleNorm = normalizeText(u.title);
    if (titleNorm && textNorm.includes(titleNorm)) score += 3;
    for (const t of u.topics || []) {
      const tNorm = normalizeText(typeof t === 'string' ? t : t.title);
      if (tNorm && tNorm.length >= 4 && textNorm.includes(tNorm)) {
        score += 1.5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestUnit = u.unitNumber;
    }
  }
  return bestScore >= 1.5 ? bestUnit : null;
}

/**
 * Computes fine-grained item-to-subtopic similarity without false-positives on broad
 * subject-wide tokens like "css" or "html".
 */
function computeExtractedItemTopicScore(normSyl, item) {
  if (!normSyl || !item) return 0;
  const itemTopic = item.normTopic || '';
  const itemConcept = item.normConcept || '';
  const itemBody = normalizeText(item.content_text || '');

  if (itemTopic === normSyl || itemConcept === normSyl) return 0.96;
  if (normSyl.length >= 4 && (itemTopic.includes(normSyl) || normSyl.includes(itemTopic))) {
    if (itemTopic.length >= 4) return 0.88;
  }
  if (normSyl.length >= 4 && (itemConcept.includes(normSyl) || normSyl.includes(itemConcept))) {
    if (itemConcept.length >= 4) return 0.86;
  }
  if (normSyl.length >= 5 && itemBody.includes(normSyl)) {
    return 0.78;
  }

  const stopTokens = new Set(['css', 'html', 'web', 'c', 'java', 'unit', 'chapter', 'introduction', 'basic', 'concept', 'and', 'the', 'for', 'with']);
  const sylTokens = normSyl
    .split(/\s+/)
    .map((w) => w.replace(/(?:es|s)$/, ''))
    .filter((w) => w.length >= 3 && !stopTokens.has(w));
  if (sylTokens.length === 0) return 0;

  const combinedItemNorm = `${itemTopic} ${itemConcept} ${itemBody}`;
  let hits = 0;
  for (const st of sylTokens) {
    if (combinedItemNorm.includes(st)) hits++;
  }
  const ratio = hits / sylTokens.length;
  if (ratio >= 0.75) return 0.82;
  if (sylTokens.length >= 2 && ratio >= 0.5 && (itemTopic.includes(sylTokens[0]) || itemConcept.includes(sylTokens[0]))) {
    return 0.68;
  }
  return 0.1;
}

/**
 * Detects whether two extracted definitions or formulas from different files
 * for the same concept/topic contain contradictory numeric values or opposing claims.
 */
function detectCrossFileConflicts(items = []) {
  const conflicts = [];
  const relevant = (items || []).filter((it) => it.item_type === 'definition' || it.item_type === 'formula');
  if (relevant.length < 2) return conflicts;

  const extractNumbers = (str) => {
    const matches = String(str || '').match(/\b\d+(?:\.\d+)?\b/g) || [];
    return matches.map((n) => Number(n));
  };

  const hasNegationPolarity = (str) => {
    return /\b(?:cannot|never|not|invalid|illegal|impossible|stateless|mutable|synchronous|connectionless)\b/i.test(str || '');
  };

  for (let i = 0; i < relevant.length; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      const a = relevant[i];
      const b = relevant[j];
      if (String(a.file_id) === String(b.file_id)) continue;

      const sameConcept = a.concept_key && b.concept_key && (
        a.concept_key === b.concept_key ||
        computeTopicSimilarity(a.concept_key, b.concept_key) >= 0.72
      );
      if (!sameConcept) continue;

      const textA = String(a.content_text || '');
      const textB = String(b.content_text || '');
      const numsA = extractNumbers(textA);
      const numsB = extractNumbers(textB);

      let conflictReason = null;
      if (numsA.length > 0 && numsB.length > 0) {
        const setA = new Set(numsA);
        const anyOverlap = numsB.some((n) => setA.has(n));
        if (!anyOverlap) {
          conflictReason = `Numeric/formula discrepancy for "${a.title || a.concept_key}": [${numsA.join(', ')}] in ${a.file_title || 'File ' + a.file_id} (p.${a.page_start}) vs [${numsB.join(', ')}] in ${b.file_title || 'File ' + b.file_id} (p.${b.page_start}).`;
        }
      }

      if (!conflictReason) {
        const negA = hasNegationPolarity(textA);
        const negB = hasNegationPolarity(textB);
        if (negA !== negB) {
          conflictReason = `Contradictory explanation detected for "${a.title || a.concept_key}" between ${a.file_title || 'File ' + a.file_id} (p.${a.page_start}) and ${b.file_title || 'File ' + b.file_id} (p.${b.page_start}).`;
        }
      }

      if (conflictReason) {
        conflicts.push({
          conceptKey: a.concept_key,
          title: a.title || b.title || a.concept_key,
          primaryItem: a,
          secondaryItem: b,
          reason: conflictReason
        });
      }
    }
  }

  return conflicts;
}

/**
 * Reconciles and persists the complete Syllabus-First Course Map for a subject (or single unit).
 */
async function syncCourseMap(db, options = {}) {
  if (!db) throw new Error('Database instance is required for syncCourseMap');
  await ensureRagSchema(db);

  const {
    subject,
    semesterNo,
    unitNumber = null
  } = options;

  const resolved = resolveCourseAndChapter(
    subject || 'Web Technology I',
    unitNumber ? `Unit ${unitNumber}` : 'Unit 1',
    semesterNo
  );
  const targetCourse = resolved.course;
  if (!targetCourse) {
    throw new Error(`Could not resolve course for subject: ${subject}`);
  }

  const courseTitle = targetCourse.title;
  const courseCode = targetCourse.code || null;
  const courseSemester = targetCourse.semesterNo || parseSemesterNumber(semesterNo) || 1;
  const now = new Date().toISOString();

  // 1. Load canonical units from syllabus-data.json (`origin_type = 'official_syllabus'`)
  const canonicalUnitsMap = new Map();
  for (const u of targetCourse.units || []) {
    const cleanedTopics = (u.topics || []).map(cleanSyllabusTopicText).filter(Boolean);
    const topicObjects = (cleanedTopics.length > 0 ? cleanedTopics : [u.title]).map((t) => ({
      title: t,
      originType: 'official_syllabus'
    }));
    canonicalUnitsMap.set(Number(u.unitNumber), {
      unitNumber: Number(u.unitNumber),
      title: u.title,
      teachingHours: extractOfficialTeachingHours(targetCourse, u.unitNumber),
      sourceOrigin: 'official_syllabus',
      syllabusFileId: null,
      topics: topicObjects
    });
  }

  // 2. Check if teacher uploaded a `syllabus` document for this course and merge any additional units/subtopics
  const syllabusFiles = await db.all(
    `SELECT f.id, f.title, f.originalName, f.resource_category
     FROM files f
     WHERE (f.subject LIKE ? OR f.subject LIKE ?)
       AND (LOWER(COALESCE(f.resource_category, '')) = 'syllabus'
            OR LOWER(COALESCE(f.title, '')) LIKE '%syllabus%'
            OR LOWER(COALESCE(f.originalName, '')) LIKE '%syllabus%')`,
    `%${courseTitle}%`,
    `%${courseCode || courseTitle}%`
  ).catch(() => []);

  for (const sf of syllabusFiles || []) {
    const pages = await db.all(
      `SELECT cleaned_text, raw_text FROM document_pages WHERE file_id = ? ORDER BY page_number ASC`,
      String(sf.id)
    ).catch(() => []);
    const fullSylText = (pages || []).map((p) => p.cleaned_text || p.raw_text || '').join('\n\n');
    const uploadedUnits = parseUploadedSyllabusText(fullSylText);
    for (const upUnit of uploadedUnits) {
      const existing = canonicalUnitsMap.get(upUnit.unitNumber);
      if (!existing) {
        canonicalUnitsMap.set(upUnit.unitNumber, {
          unitNumber: upUnit.unitNumber,
          title: upUnit.title,
          teachingHours: upUnit.teachingHours || 0,
          sourceOrigin: 'uploaded_syllabus',
          syllabusFileId: String(sf.id),
          topics: (upUnit.topics.length > 0 ? upUnit.topics : [upUnit.title]).map((t) => ({
            title: t,
            originType: 'uploaded_syllabus'
          }))
        });
      } else {
        existing.sourceOrigin = 'official_and_uploaded_syllabus';
        existing.syllabusFileId = String(sf.id);
        if (upUnit.teachingHours && !existing.teachingHours) {
          existing.teachingHours = upUnit.teachingHours;
        }
        const seenNorm = new Set(existing.topics.map((t) => normalizeText(t.title)));
        for (const t of upUnit.topics) {
          const normT = normalizeText(t);
          if (normT && !seenNorm.has(normT)) {
            seenNorm.add(normT);
            existing.topics.push({
              title: t,
              originType: 'uploaded_syllabus'
            });
          }
        }
      }
    }
  }

  const allCourseUnits = Array.from(canonicalUnitsMap.values()).sort((a, b) => a.unitNumber - b.unitNumber);
  const unitsToProcess = unitNumber !== null && unitNumber !== undefined
    ? allCourseUnits.filter((u) => u.unitNumber === Number(unitNumber))
    : allCourseUnits;

  // 3. Fetch all indexed chunks for this subject across teacher files (`notes`, `practical`, `reference`)
  const rawChunks = await db.all(
    `SELECT c.id, c.file_id, c.chunk_index, c.chunk_level, c.page_start, c.page_end,
            c.chapter, c.unit, c.section_heading, c.clean_content, c.topics_json,
            f.title AS file_title, f.originalName AS original_name,
            f.resource_category, f.unit_number AS file_unit_number,
            f.cohort_id AS file_cohort_id
     FROM document_chunks c
     JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
     WHERE (f.subject LIKE ? OR f.subject LIKE ? OR c.subject LIKE ? OR c.subject_code = ?)
       AND COALESCE(c.chunk_level, 'child') = 'child'
     ORDER BY c.file_id, c.page_start ASC, c.chunk_index ASC`,
    `%${courseTitle}%`,
    `%${courseCode || courseTitle}%`,
    `%${courseTitle}%`,
    courseCode || ''
  ).catch(() => []);

  const enrichedChunks = (rawChunks || []).map((ch) => {
    const category = classifyChunkResourceCategory(ch);
    const inferredUnit = inferChunkUnitNumber(ch, allCourseUnits);
    return {
      ...ch,
      file_id: ch.file_id ?? ch.fileId,
      file_title: ch.file_title || ch.fileTitle,
      original_name: ch.original_name || ch.originalName,
      file_cohort_id: ch.file_cohort_id ?? ch.fileCohortId ?? ch.cohort_id ?? ch.cohortId ?? null,
      page_start: ch.page_start ?? ch.pageStart ?? 1,
      page_end: ch.page_end ?? ch.pageEnd ?? 1,
      section_heading: ch.section_heading || ch.sectionHeading,
      clean_content: ch.clean_content || ch.cleanContent,
      category,
      inferredUnit,
      normHeading: normalizeText(ch.section_heading || ch.sectionHeading || ''),
      normBody: normalizeText(ch.clean_content || ch.cleanContent || ''),
      topicsList: safeJsonParse(ch.topics_json || ch.topicsJson, [])
    };
  }).filter((ch) => ch.category !== 'syllabus' && ch.category !== 'model_questions');

  // 4. Fetch all structured academic items (`academic_extracted_items`) for this course
  const rawExtractedItems = await db.all(
    `SELECT a.*, f.title AS file_title, f.originalName AS original_name,
            f.unit_number AS file_unit_number, f.cohort_id AS file_cohort_id,
            f.resource_category
     FROM academic_extracted_items a
     JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(a.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(a.file_id AS TEXT) OR f.id = CAST(a.file_id AS INTEGER))'}
     WHERE (f.subject LIKE ? OR f.subject LIKE ? OR a.subject LIKE ? OR a.course_code = ?)
     ORDER BY a.file_id, a.page_start ASC`,
    `%${courseTitle}%`,
    `%${courseCode || courseTitle}%`,
    `%${courseTitle}%`,
    courseCode || ''
  ).catch(() => []);

  const enrichedItems = (rawExtractedItems || []).map((it) => {
    const category = classifyChunkResourceCategory(it);
    const inferredUnit = Number(it.file_unit_number ?? it.fileUnitNumber ?? it.unit_number ?? it.unitNumber) || inferChunkUnitNumber({
      unit: (it.unit_number ?? it.unitNumber) ? `Unit ${it.unit_number ?? it.unitNumber}` : '',
      chapter: it.chapter,
      file_title: it.file_title || it.fileTitle,
      section_heading: it.topic || it.title,
      clean_content: it.content_text || it.contentText
    }, allCourseUnits);
    return {
      ...it,
      category,
      file_id: it.file_id ?? it.fileId,
      file_title: it.file_title || it.fileTitle,
      original_name: it.original_name || it.originalName,
      file_cohort_id: it.file_cohort_id ?? it.fileCohortId ?? it.cohort_id ?? it.cohortId ?? null,
      item_type: it.item_type || it.itemType,
      concept_key: it.concept_key || it.conceptKey,
      content_text: it.content_text || it.contentText,
      structured_json: it.structured_json || it.structuredJson,
      chunk_id: it.chunk_id || it.chunkId,
      page_start: it.page_start ?? it.pageStart ?? 1,
      page_end: it.page_end ?? it.pageEnd ?? 1,
      inferredUnit,
      normTopic: normalizeText(it.topic || it.title || ''),
      normConcept: normalizeText(it.concept_key || it.conceptKey || it.title || '')
    };
  }).filter((it) => it.category !== 'syllabus' && it.category !== 'model_questions');

  // 5. Fetch all PYQ questions for this subject
  const allPyqs = await searchPyqQuestions(db, {
    subject: courseTitle,
    subjectCode: courseCode,
    semesterNo: courseSemester,
    limit: 200
  }).catch(() => []);

  for (const unit of unitsToProcess) {
    const uNum = unit.unitNumber;
    const unitId = makeDeterministicId('csu', `${courseCode || courseTitle}|sem${courseSemester}|u${uNum}`);

    // Preserve teacher-locked topics, teacher-approved mappings, and resolved review items across rebuilds
    const prevTopics = await db.all(
      `SELECT * FROM course_syllabus_topics WHERE unit_id = ?`,
      [unitId]
    ).catch(() => []);
    const maxPrevVersion = (prevTopics || []).reduce(
      (maxV, r) => Math.max(maxV, Number(r.curriculum_version ?? r.curriculumVersion) || 1),
      0
    );
    const nextCurriculumVersion = maxPrevVersion + 1;

    const lockedTopicsByNorm = new Map();
    for (const pt of prevTopics || []) {
      if (Number(pt.is_locked_by_teacher ?? pt.isLockedByTeacher) === 1) {
        lockedTopicsByNorm.set(pt.normalized_topic || pt.normalizedTopic, pt);
      }
    }

    const prevApprovedMappings = await db.all(
      `SELECT * FROM topic_source_mappings
       WHERE subject = ? AND semester_no = ? AND unit_number = ?
         AND review_status = 'TEACHER_APPROVED'`,
      [courseTitle, courseSemester, uNum]
    ).catch(() => []);

    const prevResolvedReviews = await db.all(
      `SELECT id, status, review_type, candidate_topic_id, resolved_by_user_id, resolution_note, resolved_at
       FROM kaie_teacher_review_queue
       WHERE subject = ? AND semester_no = ? AND unit_number = ? AND status != 'PENDING'`,
      [courseTitle, courseSemester, uNum]
    ).catch(() => []);
    const resolvedReviewMap = new Map((prevResolvedReviews || []).map((r) => [r.id, r]));

    // Non-destructive sync: preserve teacher-locked topics and teacher-approved mappings via versioned upserts below

    const unitChunks = enrichedChunks.filter((ch) => ch.inferredUnit === uNum || ch.inferredUnit === null);
    const unitSpecificChunks = enrichedChunks.filter((ch) => ch.inferredUnit === uNum);
    const candidateChunks = unitSpecificChunks.length > 0 ? unitSpecificChunks : unitChunks;

    const unitItems = enrichedItems.filter((it) => it.inferredUnit === uNum || it.inferredUnit === null);
    const unitSpecificItems = enrichedItems.filter((it) => it.inferredUnit === uNum);
    const candidateItems = unitSpecificItems.length > 0 ? unitSpecificItems : unitItems;

    const unitPyqs = (allPyqs || []).filter((q) => {
      const qUnit = Number(q.unit_number || q.unitNumber);
      if (qUnit === uNum) return true;
      if (!qUnit) {
        const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || q.question_text || '');
        return unit.topics.some((t) => computeTopicSimilarity(normalizeText(t.title), qNorm) >= 0.45);
      }
      return false;
    });

    const matchedChunkIds = new Set();
    const matchedItemIds = new Set();
    const unitTopicsOut = [];
    const reviewItemsToInsert = [];
    let stepCounter = 1;

    const matchPyqsForTopic = (normTopic) => {
      return unitPyqs.filter((q) => {
        const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || q.question_text || '');
        const pNorm = normalizeText(q.primary_topic || q.primaryTopic || '');
        if (!qNorm) return false;
        if (qNorm.includes(normTopic) || (pNorm && pNorm === normTopic)) return true;
        if (computeTopicSimilarity(normTopic, qNorm) >= 0.5) return true;
        const words = normTopic.split(/\s+/).filter((w) => w.length >= 4);
        if (words.length >= 2 && words.every((w) => qNorm.includes(w.replace(/s$/, '')))) return true;
        return false;
      });
    };

    for (let sIdx = 0; sIdx < unit.topics.length; sIdx++) {
      const topicEntry = unit.topics[sIdx];
      const sylTopic = typeof topicEntry === 'string' ? topicEntry : topicEntry.title;
      const originType = (typeof topicEntry === 'object' && topicEntry.originType) || 'official_syllabus';
      const normSyl = normalizeText(sylTopic);
      const topicCode = `${uNum}.${sIdx + 1}`;
      const stepIdx = stepCounter++;
      const topicId = makeDeterministicId('cst', `${unitId}|step${stepIdx}|${normSyl}`);

      const matchingNoteChunks = [];
      const matchingPracticalChunks = [];

      for (const ch of candidateChunks) {
        let score = computeTopicSimilarity(normSyl, ch.normHeading, ch.topicsList);
        const directBodyContain = normSyl.length >= 4 && ch.normBody.includes(normSyl);
        if (score < 0.72 && directBodyContain) {
          score = 0.75;
        }
        if (score >= 0.42) {
          const isUncertain = score < 0.72 && !directBodyContain;
          const reviewId = makeDeterministicId('ktrq', `uncertain|${topicId}|${ch.id}`);
          const prevRes = resolvedReviewMap.get(reviewId);
          if (prevRes && prevRes.status === 'DISMISSED') {
            continue;
          }
          const reviewStatus = (prevRes && prevRes.status === 'APPROVED')
            ? 'TEACHER_APPROVED'
            : isUncertain
              ? 'NEEDS_REVIEW'
              : 'AUTO_APPROVED';

          matchedChunkIds.add(ch.id);
          if (isUncertain && !prevRes) {
            reviewItemsToInsert.push({
              id: reviewId,
              course_code: courseCode,
              subject: courseTitle,
              semester_no: courseSemester,
              unit_number: uNum,
              review_type: 'UNCERTAIN_SYLLABUS_MAPPING',
              status: 'PENDING',
              candidate_topic_id: topicId,
              topic_title: sylTopic,
              extracted_concept: ch.section_heading || sylTopic,
              primary_file_id: String(ch.file_id),
              primary_file_title: ch.file_title || ch.original_name || `File #${ch.file_id}`,
              primary_page_start: ch.page_start || 1,
              secondary_file_id: null,
              secondary_file_title: null,
              secondary_page_start: null,
              confidence: Number(score.toFixed(3)),
              evidence_summary: `Section "${ch.section_heading || 'Untitled'}" in ${ch.file_title || 'uploaded notes'} (p.${ch.page_start || 1}) matched official syllabus topic "${sylTopic}" with borderline confidence (${Math.round(score * 100)}%).`,
              payload_json: JSON.stringify({
                chunkId: ch.id,
                snippet: String(ch.clean_content || '').slice(0, 240)
              })
            });
          }

          if (ch.category === 'practical') {
            matchingPracticalChunks.push({ chunk: ch, score, reviewStatus });
          } else {
            matchingNoteChunks.push({ chunk: ch, score, reviewStatus });
          }
        }
      }

      // Match structured extracted items (`definition`, `formula`, `code_example`, `worked_example`, `diagram`, `inline_question`)
      const matchingItems = [];
      for (const it of candidateItems) {
        const iScore = computeExtractedItemTopicScore(normSyl, it);
        if (iScore >= 0.65) {
          matchedItemIds.add(it.id);
          matchingItems.push({ item: it, score: iScore });
        }
      }

      // Check cross-file conflicts among extracted items mapped to this topic
      const topicConflicts = detectCrossFileConflicts(matchingItems.map((m) => m.item));
      const conflictedItemIds = new Set();
      for (const conf of topicConflicts) {
        conflictedItemIds.add(conf.primaryItem.id);
        conflictedItemIds.add(conf.secondaryItem.id);
        const confReviewId = makeDeterministicId('ktrq', `conflict|${topicId}|${conf.primaryItem.id}|${conf.secondaryItem.id}`);
        if (!resolvedReviewMap.has(confReviewId)) {
          reviewItemsToInsert.push({
            id: confReviewId,
            course_code: courseCode,
            subject: courseTitle,
            semester_no: courseSemester,
            unit_number: uNum,
            review_type: 'CROSS_FILE_CONFLICT',
            status: 'PENDING',
            candidate_topic_id: topicId,
            topic_title: sylTopic,
            extracted_concept: conf.title,
            primary_file_id: String(conf.primaryItem.file_id),
            primary_file_title: conf.primaryItem.file_title || conf.primaryItem.original_name || `File #${conf.primaryItem.file_id}`,
            primary_page_start: conf.primaryItem.page_start || 1,
            secondary_file_id: String(conf.secondaryItem.file_id),
            secondary_file_title: conf.secondaryItem.file_title || conf.secondaryItem.original_name || `File #${conf.secondaryItem.file_id}`,
            secondary_page_start: conf.secondaryItem.page_start || 1,
            confidence: 0.85,
            evidence_summary: conf.reason,
            payload_json: JSON.stringify({
              primaryText: conf.primaryItem.content_text,
              secondaryText: conf.secondaryItem.content_text,
              primaryItemId: conf.primaryItem.id,
              secondaryItemId: conf.secondaryItem.id
            })
          });
        }
      }

      const matchedPyqs = matchPyqsForTopic(normSyl);
      const hasNotes = matchingNoteChunks.length > 0 || matchingItems.some((m) => m.item.category !== 'practical');
      const hasPractical = matchingPracticalChunks.length > 0 || matchingItems.some((m) => m.item.category === 'practical' || m.item.item_type === 'code_example');
      const hasPyq = matchedPyqs.length > 0;

      const sourceOrigin = (hasNotes || hasPractical) ? 'syllabus_and_note' : 'syllabus_only';
      const coverageStatus = (hasNotes && hasPractical)
        ? 'COMPLETE'
        : hasNotes
          ? 'NOTES_COVERED'
          : hasPractical
            ? 'PRACTICAL_ONLY'
            : 'MISSING_NOTES';

      const totalPyqMarks = matchedPyqs.reduce((sum, q) => sum + (Number(q.marks) || 5), 0);
      const examWeightScore = Number(Math.min(10, matchedPyqs.length * 2.5 + totalPyqMarks * 0.15).toFixed(2));

      const mappings = [];
      for (const { chunk, score, reviewStatus } of matchingNoteChunks) {
        mappings.push({
          id: makeDeterministicId('tsm', `${topicId}|note|${chunk.id}`),
          topicId,
          cohortId: chunk.file_cohort_id ?? null,
          sourceType: chunk.category === 'reference' ? 'reference' : 'notes',
          fileId: String(chunk.file_id),
          fileTitle: chunk.file_title || chunk.original_name || `Note #${chunk.file_id}`,
          chunkId: chunk.id,
          extractedItemId: null,
          pyqQuestionId: null,
          pageStart: chunk.page_start || 1,
          pageEnd: chunk.page_end || chunk.page_start || 1,
          sectionHeading: chunk.section_heading || sylTopic,
          relevanceScore: Number(score.toFixed(3)),
          reviewStatus: reviewStatus || 'AUTO_APPROVED',
          conflictStatus: 'NONE',
          snippet: String(chunk.clean_content || '').slice(0, 280)
        });
      }

      for (const { chunk, score, reviewStatus } of matchingPracticalChunks) {
        mappings.push({
          id: makeDeterministicId('tsm', `${topicId}|practical|${chunk.id}`),
          topicId,
          cohortId: chunk.file_cohort_id ?? null,
          sourceType: 'practical',
          fileId: String(chunk.file_id),
          fileTitle: chunk.file_title || chunk.original_name || `Practical #${chunk.file_id}`,
          chunkId: chunk.id,
          extractedItemId: null,
          pyqQuestionId: null,
          pageStart: chunk.page_start || 1,
          pageEnd: chunk.page_end || chunk.page_start || 1,
          sectionHeading: chunk.section_heading || sylTopic,
          relevanceScore: Number(score.toFixed(3)),
          reviewStatus: reviewStatus || 'AUTO_APPROVED',
          conflictStatus: 'NONE',
          snippet: String(chunk.clean_content || '').slice(0, 280)
        });
      }

      for (const { item, score } of matchingItems) {
        const isConflicted = conflictedItemIds.has(item.id);
        mappings.push({
          id: makeDeterministicId('tsm', `${topicId}|item|${item.id}`),
          topicId,
          cohortId: item.file_cohort_id ?? null,
          sourceType: item.item_type,
          fileId: String(item.file_id),
          fileTitle: item.file_title || item.original_name || `Resource #${item.file_id}`,
          chunkId: item.chunk_id || null,
          extractedItemId: item.id,
          pyqQuestionId: null,
          pageStart: item.page_start || 1,
          pageEnd: item.page_end || item.page_start || 1,
          sectionHeading: item.title || sylTopic,
          relevanceScore: Number(score.toFixed(3)),
          reviewStatus: isConflicted ? 'NEEDS_REVIEW' : 'AUTO_APPROVED',
          conflictStatus: isConflicted ? 'CONFLICT_DETECTED' : 'NONE',
          snippet: String(item.content_text || '').slice(0, 420),
          metadata: safeJsonParse(item.structured_json, {})
        });
      }

      for (const q of matchedPyqs) {
        mappings.push({
          id: makeDeterministicId('tsm', `${topicId}|pyq|${q.id}`),
          topicId,
          cohortId: null,
          sourceType: 'model_questions',
          fileId: q.file_id ? String(q.file_id) : null,
          fileTitle: `${q.exam_year || 'Past'} ${q.exam_type || 'Exam'}`,
          chunkId: null,
          extractedItemId: null,
          pyqQuestionId: q.id,
          pageStart: q.page_number || 1,
          pageEnd: q.page_number || 1,
          sectionHeading: `Q.${q.question_number || '1'} (${q.marks || 5} Marks)`,
          relevanceScore: 0.9,
          reviewStatus: 'AUTO_APPROVED',
          conflictStatus: 'NONE',
          snippet: String(q.clean_question_text || q.question_text || '').slice(0, 280),
          metadata: {
            examYear: q.exam_year || q.examYear,
            examType: q.exam_type || q.examType,
            questionNumber: q.question_number || q.questionNumber,
            marks: q.marks || 5
          }
        });
      }

      const prerequisiteTopicIds = unitTopicsOut.length > 0
        ? [unitTopicsOut[unitTopicsOut.length - 1].id]
        : [];

      const lockedRow = lockedTopicsByNorm.get(normSyl);

      unitTopicsOut.push({
        id: topicId,
        unitId,
        subject: courseTitle,
        subjectCode: courseCode,
        semesterNo: courseSemester,
        unitNumber: uNum,
        stepIndex: stepIdx,
        topicCode,
        topicTitle: lockedRow ? (lockedRow.topic_title || lockedRow.topicTitle || sylTopic) : sylTopic,
        normalizedTopic: normSyl,
        parentTopicId: null,
        originType,
        prerequisiteTopicIds,
        curriculumVersion: nextCurriculumVersion,
        isLockedByTeacher: lockedRow ? 1 : 0,
        sourceOrigin,
        coverageStatus,
        hasNotes,
        hasPractical,
        hasPyq,
        noteChunksCount: matchingNoteChunks.length,
        practicalChunksCount: matchingPracticalChunks.length,
        pyqCount: matchedPyqs.length,
        examWeightScore,
        mappings
      });
    }

    // 6. Append any teacher-note-exclusive headings as `origin_type = 'teaching_subtopic'`
    const seenExtraHeadings = new Set(unitTopicsOut.map((t) => t.normalizedTopic));
    for (const ch of unitSpecificChunks) {
      if (matchedChunkIds.has(ch.id)) continue;
      const heading = String(ch.section_heading || '').trim();
      const normHead = normalizeText(heading);
      if (isGenericHeading(heading) || !normHead || seenExtraHeadings.has(normHead)) continue;
      seenExtraHeadings.add(normHead);
      matchedChunkIds.add(ch.id);

      const stepIdx = stepCounter++;
      const topicId = makeDeterministicId('cst', `${unitId}|extra${stepIdx}|${normHead}`);
      const unmappedReviewId = makeDeterministicId('ktrq', `unmapped|${topicId}|${ch.id}`);
      const prevRes = resolvedReviewMap.get(unmappedReviewId);
      if (prevRes && prevRes.status === 'DISMISSED') {
        continue;
      }

      const matchedPyqs = matchPyqsForTopic(normHead);
      const isPrac = ch.category === 'practical';
      const totalPyqMarks = matchedPyqs.reduce((sum, q) => sum + (Number(q.marks) || 5), 0);
      const examWeightScore = Number(Math.min(10, matchedPyqs.length * 2.5 + totalPyqMarks * 0.15).toFixed(2));

      if (!prevRes) {
        reviewItemsToInsert.push({
          id: unmappedReviewId,
          course_code: courseCode,
          subject: courseTitle,
          semester_no: courseSemester,
          unit_number: uNum,
          review_type: 'UNMAPPED_NOTE_TOPIC',
          status: 'PENDING',
          candidate_topic_id: topicId,
          topic_title: heading,
          extracted_concept: heading,
          primary_file_id: String(ch.file_id),
          primary_file_title: ch.file_title || ch.original_name || `Teacher Note #${ch.file_id}`,
          primary_page_start: ch.page_start || 1,
          secondary_file_id: null,
          secondary_file_title: null,
          secondary_page_start: null,
          confidence: 0.75,
          evidence_summary: `Heading "${heading}" in ${ch.file_title || 'uploaded notes'} (p.${ch.page_start || 1}) is not explicitly listed in the official Unit ${uNum} syllabus and was added as a Teaching Curriculum subtopic.`,
          payload_json: JSON.stringify({
            chunkId: ch.id,
            snippet: String(ch.clean_content || '').slice(0, 240)
          })
        });
      }

      const mappings = [{
        id: makeDeterministicId('tsm', `${topicId}|${isPrac ? 'practical' : 'note'}|${ch.id}`),
        topicId,
        cohortId: ch.file_cohort_id ?? null,
        sourceType: isPrac ? 'practical' : 'notes',
        fileId: String(ch.file_id),
        fileTitle: ch.file_title || ch.original_name || `Teacher Note #${ch.file_id}`,
        chunkId: ch.id,
        extractedItemId: null,
        pyqQuestionId: null,
        pageStart: ch.page_start || 1,
        pageEnd: ch.page_end || ch.page_start || 1,
        sectionHeading: heading,
        relevanceScore: 0.85,
        reviewStatus: (prevRes && prevRes.status === 'APPROVED') ? 'TEACHER_APPROVED' : 'NEEDS_REVIEW',
        conflictStatus: 'NONE',
        snippet: String(ch.clean_content || '').slice(0, 280)
      }];

      for (const it of candidateItems) {
        if (matchedItemIds.has(it.id)) continue;
        if (computeExtractedItemTopicScore(normHead, it) >= 0.65) {
          matchedItemIds.add(it.id);
          mappings.push({
            id: makeDeterministicId('tsm', `${topicId}|item|${it.id}`),
            topicId,
            cohortId: it.file_cohort_id ?? null,
            sourceType: it.item_type,
            fileId: String(it.file_id),
            fileTitle: it.file_title || it.original_name || `Resource #${it.file_id}`,
            chunkId: it.chunk_id || null,
            extractedItemId: it.id,
            pyqQuestionId: null,
            pageStart: it.page_start || 1,
            pageEnd: it.page_end || it.page_start || 1,
            sectionHeading: it.title || heading,
            relevanceScore: 0.85,
            reviewStatus: 'AUTO_APPROVED',
            conflictStatus: 'NONE',
            snippet: String(it.content_text || '').slice(0, 420),
            metadata: safeJsonParse(it.structured_json, {})
          });
        }
      }

      for (const q of matchedPyqs) {
        mappings.push({
          id: makeDeterministicId('tsm', `${topicId}|pyq|${q.id}`),
          topicId,
          cohortId: null,
          sourceType: 'model_questions',
          fileId: q.file_id ? String(q.file_id) : null,
          fileTitle: `${q.exam_year || 'Past'} ${q.exam_type || 'Exam'}`,
          chunkId: null,
          extractedItemId: null,
          pyqQuestionId: q.id,
          pageStart: q.page_number || 1,
          pageEnd: q.page_number || 1,
          sectionHeading: `Q.${q.question_number || '1'} (${q.marks || 5} Marks)`,
          relevanceScore: 0.9,
          reviewStatus: 'AUTO_APPROVED',
          conflictStatus: 'NONE',
          snippet: String(q.clean_question_text || q.question_text || '').slice(0, 280),
          metadata: {
            examYear: q.exam_year || q.examYear,
            examType: q.exam_type || q.examType,
            questionNumber: q.question_number || q.questionNumber,
            marks: q.marks || 5
          }
        });
      }

      const prerequisiteTopicIds = unitTopicsOut.length > 0
        ? [unitTopicsOut[unitTopicsOut.length - 1].id]
        : [];

      const lockedExtraRow = lockedTopicsByNorm.get(normHead);

      unitTopicsOut.push({
        id: topicId,
        unitId,
        subject: courseTitle,
        subjectCode: courseCode,
        semesterNo: courseSemester,
        unitNumber: uNum,
        stepIndex: stepIdx,
        topicCode: `${uNum}.E${stepIdx}`,
        topicTitle: heading,
        normalizedTopic: normHead,
        parentTopicId: unitTopicsOut[0]?.id || null,
        originType: 'teaching_subtopic',
        prerequisiteTopicIds,
        curriculumVersion: nextCurriculumVersion,
        isLockedByTeacher: (lockedExtraRow || (prevRes && prevRes.status === 'APPROVED')) ? 1 : 0,
        sourceOrigin: 'note_exclusive',
        coverageStatus: isPrac ? 'PRACTICAL_ONLY' : 'NOTES_COVERED',
        hasNotes: !isPrac,
        hasPractical: isPrac,
        hasPyq: matchedPyqs.length > 0,
        noteChunksCount: isPrac ? 0 : 1,
        practicalChunksCount: isPrac ? 1 : 0,
        pyqCount: matchedPyqs.length,
        examWeightScore,
        mappings
      });
    }

    // Re-attach any previously teacher-approved custom mappings that weren't regenerated
    for (const pam of prevApprovedMappings) {
      const pamTopicId = pam.topic_id || pam.topicId;
      const pamNormTopic = pam.normalized_topic || pam.normalizedTopic;
      const targetTopic = unitTopicsOut.find((t) => t.id === pamTopicId || t.normalizedTopic === pamNormTopic);
      if (targetTopic && !targetTopic.mappings.some((m) => m.id === pam.id)) {
        targetTopic.mappings.push({
          id: pam.id,
          topicId: targetTopic.id,
          cohortId: pam.cohort_id ?? pam.cohortId ?? null,
          sourceType: pam.source_type || pam.sourceType,
          fileId: pam.file_id || pam.fileId,
          fileTitle: pam.file_title || pam.fileTitle,
          chunkId: pam.chunk_id || pam.chunkId,
          extractedItemId: pam.extracted_item_id || pam.extractedItemId || null,
          pyqQuestionId: pam.pyq_question_id || pam.pyqQuestionId || null,
          pageStart: pam.page_start ?? pam.pageStart ?? 1,
          pageEnd: pam.page_end ?? pam.pageEnd ?? 1,
          sectionHeading: pam.section_heading || pam.sectionHeading,
          relevanceScore: pam.relevance_score ?? pam.relevanceScore ?? 0.95,
          reviewStatus: 'TEACHER_APPROVED',
          conflictStatus: pam.conflict_status || pam.conflictStatus || 'RESOLVED',
          snippet: pam.snippet || '',
          metadata: safeJsonParse(pam.metadata_json || pam.metadataJson, {})
        });
      }
    }

    // Also run unit-wide cross-file conflict detection across any remaining extracted items in this unit
    const unitWideConflicts = detectCrossFileConflicts(candidateItems);
    for (const conf of unitWideConflicts) {
      const targetTopic = unitTopicsOut.find((t) =>
        t.mappings.some((m) => m.extractedItemId === conf.primaryItem.id || m.extractedItemId === conf.secondaryItem.id)
      ) || unitTopicsOut[0];
      if (!targetTopic) continue;
      for (const m of targetTopic.mappings) {
        if (m.extractedItemId === conf.primaryItem.id || m.extractedItemId === conf.secondaryItem.id) {
          m.conflictStatus = 'CONFLICT_DETECTED';
          m.reviewStatus = 'NEEDS_REVIEW';
        }
      }
      const confReviewId = makeDeterministicId('ktrq', `conflict|${targetTopic.id}|${conf.primaryItem.id}|${conf.secondaryItem.id}`);
      if (!resolvedReviewMap.has(confReviewId) && !reviewItemsToInsert.some((r) => r.id === confReviewId)) {
        reviewItemsToInsert.push({
          id: confReviewId,
          course_code: courseCode,
          subject: courseTitle,
          semester_no: courseSemester,
          unit_number: uNum,
          review_type: 'CROSS_FILE_CONFLICT',
          status: 'PENDING',
          candidate_topic_id: targetTopic.id,
          topic_title: targetTopic.topicTitle,
          extracted_concept: conf.title,
          primary_file_id: String(conf.primaryItem.file_id),
          primary_file_title: conf.primaryItem.file_title || conf.primaryItem.original_name || `File #${conf.primaryItem.file_id}`,
          primary_page_start: conf.primaryItem.page_start || 1,
          secondary_file_id: String(conf.secondaryItem.file_id),
          secondary_file_title: conf.secondaryItem.file_title || conf.secondaryItem.original_name || `File #${conf.secondaryItem.file_id}`,
          secondary_page_start: conf.secondaryItem.page_start || 1,
          confidence: 0.85,
          evidence_summary: conf.reason,
          payload_json: JSON.stringify({
            primaryText: conf.primaryItem.content_text,
            secondaryText: conf.secondaryItem.content_text,
            primaryItemId: conf.primaryItem.id,
            secondaryItemId: conf.secondaryItem.id
          })
        });
      }
    }

    // 7. Persist unit + topics + mappings + review queue items
    const totalTopicsCount = unitTopicsOut.length;
    const coveredTopicsCount = unitTopicsOut.filter((t) => t.hasNotes || t.hasPractical).length;
    const coverageRatio = totalTopicsCount > 0
      ? Number((coveredTopicsCount / totalTopicsCount).toFixed(3))
      : 0;

    await db.run(
      `INSERT INTO course_syllabus_units (
        id, subject, subject_code, semester_no, unit_number, unit_title,
        teaching_hours, source_origin, syllabus_file_id, total_topics,
        covered_topics, pyq_questions_count, coverage_ratio, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        unit_title = excluded.unit_title,
        teaching_hours = excluded.teaching_hours,
        source_origin = excluded.source_origin,
        syllabus_file_id = excluded.syllabus_file_id,
        total_topics = excluded.total_topics,
        covered_topics = excluded.covered_topics,
        pyq_questions_count = excluded.pyq_questions_count,
        coverage_ratio = excluded.coverage_ratio,
        updated_at = excluded.updated_at`,
      [
        unitId,
        courseTitle,
        courseCode,
        courseSemester,
        uNum,
        unit.title,
        unit.teachingHours || 0,
        unit.sourceOrigin,
        unit.syllabusFileId,
        totalTopicsCount,
        coveredTopicsCount,
        unitPyqs.length,
        coverageRatio,
        now
      ]
    );

    // Clean up stale unlocked topics for this unit before inserting new step_indexes to avoid unique constraint collisions
    await db.run(
      `DELETE FROM course_syllabus_topics WHERE unit_id = ? AND COALESCE(is_locked_by_teacher, 0) = 0`,
      [unitId]
    ).catch(() => {});

    const activeTopicIds = [];
    const activeMappingIds = [];

    const allUnitMappings = [];
    for (const topicRow of unitTopicsOut) {
      activeTopicIds.push(topicRow.id);
      await db.run(
        `INSERT INTO course_syllabus_topics (
          id, unit_id, subject, subject_code, semester_no, unit_number,
          step_index, topic_code, topic_title, normalized_topic, parent_topic_id,
          origin_type, prerequisite_topic_ids_json, curriculum_version, is_locked_by_teacher,
          source_origin, coverage_status, has_notes, has_practical, has_pyq,
          note_chunks_count, practical_chunks_count, pyq_count, exam_weight_score, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          step_index = excluded.step_index,
          topic_code = excluded.topic_code,
          topic_title = CASE WHEN course_syllabus_topics.is_locked_by_teacher = 1 THEN course_syllabus_topics.topic_title ELSE excluded.topic_title END,
          origin_type = CASE WHEN course_syllabus_topics.origin_type = 'official_syllabus' THEN 'official_syllabus' ELSE excluded.origin_type END,
          prerequisite_topic_ids_json = excluded.prerequisite_topic_ids_json,
          curriculum_version = excluded.curriculum_version,
          is_locked_by_teacher = CASE WHEN course_syllabus_topics.is_locked_by_teacher = 1 THEN 1 ELSE excluded.is_locked_by_teacher END,
          source_origin = excluded.source_origin,
          coverage_status = excluded.coverage_status,
          has_notes = excluded.has_notes,
          has_practical = excluded.has_practical,
          has_pyq = excluded.has_pyq,
          note_chunks_count = excluded.note_chunks_count,
          practical_chunks_count = excluded.practical_chunks_count,
          pyq_count = excluded.pyq_count,
          exam_weight_score = excluded.exam_weight_score,
          updated_at = excluded.updated_at`,
        [
          topicRow.id,
          topicRow.unitId,
          topicRow.subject,
          topicRow.subjectCode,
          topicRow.semesterNo,
          topicRow.unitNumber,
          topicRow.stepIndex,
          topicRow.topicCode,
          topicRow.topicTitle,
          topicRow.normalizedTopic,
          topicRow.parentTopicId,
          topicRow.originType || 'official_syllabus',
          JSON.stringify(topicRow.prerequisiteTopicIds || []),
          topicRow.curriculumVersion || 1,
          topicRow.isLockedByTeacher ? 1 : 0,
          topicRow.sourceOrigin,
          topicRow.coverageStatus,
          topicRow.hasNotes ? 1 : 0,
          topicRow.hasPractical ? 1 : 0,
          topicRow.hasPyq ? 1 : 0,
          topicRow.noteChunksCount,
          topicRow.practicalChunksCount,
          topicRow.pyqCount,
          topicRow.examWeightScore,
          now
        ]
      );

      for (const m of topicRow.mappings) {
        activeMappingIds.push(m.id);
        allUnitMappings.push({ m, topicRow });
      }
    }

    const MAPPING_BATCH_SIZE = 25;
    for (let mIdx = 0; mIdx < allUnitMappings.length; mIdx += MAPPING_BATCH_SIZE) {
      const slice = allUnitMappings.slice(mIdx, mIdx + MAPPING_BATCH_SIZE);
      const placeholders = [];
      const params = [];
      for (const { m, topicRow } of slice) {
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        params.push(
          m.id,
          m.topicId,
          courseTitle,
          courseSemester,
          uNum,
          m.cohortId ?? null,
          topicRow.normalizedTopic,
          m.sourceType,
          m.fileId,
          m.fileTitle,
          m.chunkId,
          m.extractedItemId || null,
          m.pyqQuestionId,
          m.pageStart,
          m.pageEnd,
          m.sectionHeading,
          m.relevanceScore,
          m.reviewStatus || 'AUTO_APPROVED',
          m.conflictStatus || 'NONE',
          topicRow.curriculumVersion || 1,
          m.snippet || '',
          JSON.stringify(m.metadata || {}),
          now
        );
      }
      if (placeholders.length > 0) {
        await db.run(
          `INSERT INTO topic_source_mappings (
            id, topic_id, subject, semester_no, unit_number, cohort_id, normalized_topic,
            source_type, file_id, file_title, chunk_id, extracted_item_id, pyq_question_id,
            page_start, page_end, section_heading, relevance_score,
            review_status, conflict_status, curriculum_version, snippet,
            metadata_json, created_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT(id) DO UPDATE SET
            cohort_id = excluded.cohort_id,
            file_title = excluded.file_title,
            page_start = excluded.page_start,
            page_end = excluded.page_end,
            section_heading = excluded.section_heading,
            relevance_score = excluded.relevance_score,
            review_status = CASE WHEN topic_source_mappings.review_status = 'TEACHER_APPROVED' THEN 'TEACHER_APPROVED' ELSE excluded.review_status END,
            conflict_status = CASE WHEN topic_source_mappings.review_status = 'TEACHER_APPROVED' THEN topic_source_mappings.conflict_status ELSE excluded.conflict_status END,
            curriculum_version = excluded.curriculum_version,
            snippet = excluded.snippet,
            metadata_json = excluded.metadata_json`,
          params
        );
      }
    }

    // Prune only stale unlocked non-official topics and non-teacher-approved mappings that were removed
    if (activeTopicIds.length > 0) {
      const tPlaceholders = activeTopicIds.map(() => '?').join(',');
      await db.run(
        `DELETE FROM course_syllabus_topics
         WHERE unit_id = ?
           AND COALESCE(is_locked_by_teacher, 0) = 0
           AND COALESCE(origin_type, 'official_syllabus') != 'official_syllabus'
           AND id NOT IN (${tPlaceholders})`,
        [unitId, ...activeTopicIds]
      );
    }
    if (activeMappingIds.length > 0) {
      const mPlaceholders = activeMappingIds.map(() => '?').join(',');
      await db.run(
        `DELETE FROM topic_source_mappings
         WHERE subject = ? AND semester_no = ? AND unit_number = ?
           AND COALESCE(review_status, '') != 'TEACHER_APPROVED'
           AND id NOT IN (${mPlaceholders})`,
        [courseTitle, courseSemester, uNum, ...activeMappingIds]
      );
    } else {
      await db.run(
        `DELETE FROM topic_source_mappings
         WHERE subject = ? AND semester_no = ? AND unit_number = ?
           AND COALESCE(review_status, '') != 'TEACHER_APPROVED'`,
        [courseTitle, courseSemester, uNum]
      );
    }

    const activeReviewIds = [];
    const REVIEW_BATCH_SIZE = 25;
    for (let rIdx = 0; rIdx < reviewItemsToInsert.length; rIdx += REVIEW_BATCH_SIZE) {
      const slice = reviewItemsToInsert.slice(rIdx, rIdx + REVIEW_BATCH_SIZE);
      const placeholders = [];
      const params = [];
      for (const rq of slice) {
        activeReviewIds.push(rq.id);
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        params.push(
          rq.id,
          rq.course_code,
          rq.subject,
          rq.semester_no,
          rq.unit_number,
          rq.review_type,
          rq.status || 'PENDING',
          rq.candidate_topic_id,
          rq.topic_title,
          rq.extracted_concept,
          rq.primary_file_id,
          rq.primary_file_title,
          rq.primary_page_start,
          rq.secondary_file_id,
          rq.secondary_file_title,
          rq.secondary_page_start,
          rq.confidence,
          rq.evidence_summary,
          rq.payload_json,
          now,
          now
        );
      }
      if (placeholders.length > 0) {
        await db.run(
          `INSERT INTO kaie_teacher_review_queue (
            id, course_code, subject, semester_no, unit_number,
            review_type, status, candidate_topic_id, topic_title, extracted_concept,
            primary_file_id, primary_file_title, primary_page_start,
            secondary_file_id, secondary_file_title, secondary_page_start,
            confidence, evidence_summary, payload_json, created_at, updated_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT(id) DO UPDATE SET
            confidence = CASE WHEN kaie_teacher_review_queue.status = 'PENDING' THEN excluded.confidence ELSE kaie_teacher_review_queue.confidence END,
            evidence_summary = CASE WHEN kaie_teacher_review_queue.status = 'PENDING' THEN excluded.evidence_summary ELSE kaie_teacher_review_queue.evidence_summary END,
            payload_json = CASE WHEN kaie_teacher_review_queue.status = 'PENDING' THEN excluded.payload_json ELSE kaie_teacher_review_queue.payload_json END,
            updated_at = CASE WHEN kaie_teacher_review_queue.status = 'PENDING' THEN excluded.updated_at ELSE kaie_teacher_review_queue.updated_at END`,
          params
        );
      }
    }
    if (activeReviewIds.length > 0) {
      const rPlaceholders = activeReviewIds.map(() => '?').join(',');
      await db.run(
        `DELETE FROM kaie_teacher_review_queue
         WHERE subject = ? AND semester_no = ? AND unit_number = ?
           AND status = 'PENDING'
           AND id NOT IN (${rPlaceholders})`,
        [courseTitle, courseSemester, uNum, ...activeReviewIds]
      );
    } else {
      await db.run(
        `DELETE FROM kaie_teacher_review_queue
         WHERE subject = ? AND semester_no = ? AND unit_number = ?
           AND status = 'PENDING'`,
        [courseTitle, courseSemester, uNum]
      );
    }
  }

  return getCourseMap(db, {
    subject: courseTitle,
    semesterNo: courseSemester,
    unitNumber,
    academicContext: options.academicContext
  });
}

/**
 * Retrieves the persisted Syllabus-First Course Map for a subject (and optional unitNumber).
 * Supports cohort & semester visibility scoping via `options.academicContext` or `options.cohortId`.
 */
async function getCourseMap(db, options = {}) {
  if (!db) return null;
  await ensureRagSchema(db);

  const resolved = resolveCourseAndChapter(
    options.subject || 'Web Technology I',
    options.unitNumber ? `Unit ${options.unitNumber}` : 'Unit 1',
    options.semesterNo
  );
  const targetCourse = resolved.course;
  if (!targetCourse) return null;

  const courseTitle = targetCourse.title;
  const courseCode = targetCourse.code || null;
  const courseSemester = targetCourse.semesterNo || parseSemesterNumber(options.semesterNo) || 1;
  const filterUnit = options.unitNumber !== undefined && options.unitNumber !== null
    ? Number(options.unitNumber)
    : null;

  const unitRows = await db.all(
    filterUnit
      ? `SELECT * FROM course_syllabus_units WHERE subject = ? AND semester_no = ? AND unit_number = ? ORDER BY unit_number ASC`
      : `SELECT * FROM course_syllabus_units WHERE subject = ? AND semester_no = ? ORDER BY unit_number ASC`,
    ...(filterUnit ? [courseTitle, courseSemester, filterUnit] : [courseTitle, courseSemester])
  );

  if (!unitRows || unitRows.length === 0) {
    if (options._syncedOnce) {
      return {
        subject: courseTitle,
        subjectCode: courseCode,
        semesterNo: courseSemester,
        units: [],
        summary: {
          totalUnits: 0,
          totalTopics: 0,
          coveredTopics: 0,
          missingTopicsCount: 0,
          missingTopics: [],
          coverageRatio: 0,
          totalPyqs: 0,
          reviewQueueCount: 0,
          conflictsCount: 0
        }
      };
    }
    return syncCourseMap(db, { ...options, _syncedOnce: true });
  }

  const topicRows = await db.all(
    filterUnit
      ? `SELECT * FROM course_syllabus_topics WHERE subject = ? AND semester_no = ? AND unit_number = ? ORDER BY unit_number ASC, step_index ASC`
      : `SELECT * FROM course_syllabus_topics WHERE subject = ? AND semester_no = ? ORDER BY unit_number ASC, step_index ASC`,
    ...(filterUnit ? [courseTitle, courseSemester, filterUnit] : [courseTitle, courseSemester])
  );

  const mappingRows = await db.all(
    filterUnit
      ? `SELECT * FROM topic_source_mappings WHERE subject = ? AND semester_no = ? AND unit_number = ? ORDER BY relevance_score DESC`
      : `SELECT * FROM topic_source_mappings WHERE subject = ? AND semester_no = ? ORDER BY relevance_score DESC`,
    ...(filterUnit ? [courseTitle, courseSemester, filterUnit] : [courseTitle, courseSemester])
  );

  const reviewRows = await db.all(
    filterUnit
      ? `SELECT * FROM kaie_teacher_review_queue WHERE subject = ? AND semester_no = ? AND unit_number = ? AND status = 'PENDING' ORDER BY created_at DESC`
      : `SELECT * FROM kaie_teacher_review_queue WHERE subject = ? AND semester_no = ? AND status = 'PENDING' ORDER BY created_at DESC`,
    ...(filterUnit ? [courseTitle, courseSemester, filterUnit] : [courseTitle, courseSemester])
  ).catch(() => []);

  // Cohort & centralized resource authorization filter for students and teachers
  const ctx = options.academicContext || null;
  const callerRole = String(ctx?.role || options.role || '').toLowerCase();
  const studentCohortId = ctx?.cohort?.id !== undefined
    ? ctx.cohort.id
    : (ctx?.cohortId !== undefined ? ctx.cohortId : (options.cohortId !== undefined ? options.cohortId : undefined));
  const enforceCohortScope = callerRole === 'student' || callerRole === 'cr' || callerRole === 'teacher' || (studentCohortId !== undefined && callerRole !== 'admin');

  // Load live file rows for mapped file IDs so deleted, hidden, visibility-restricted, or unauthorized files are excluded
  const mappedFileIds = Array.from(new Set(
    (mappingRows || [])
      .map((m) => m.file_id ?? m.fileId)
      .filter((fid) => fid !== null && fid !== undefined && String(fid).trim() !== '')
      .map((fid) => Number(fid))
      .filter((n) => Number.isFinite(n) && n > 0)
  ));
  const liveFileById = new Map();
  if (mappedFileIds.length > 0) {
    const fPlaceholders = mappedFileIds.map(() => '?').join(',');
    const fRows = await db.all(`SELECT * FROM files WHERE id IN (${fPlaceholders})`, ...mappedFileIds).catch(() => []);
    for (const f of fRows || []) {
      liveFileById.set(String(f.id), f);
    }
  }

  const { canReadResource } = require('./kyana-access');
  const authContext = ctx
    ? (ctx.authenticated !== undefined ? ctx : { ...ctx, authenticated: true })
    : (studentCohortId !== undefined || callerRole ? { authenticated: true, role: callerRole || 'student', cohortId: studentCohortId, currentSemester: courseSemester } : null);

  const isMappingVisibleToCaller = (m) => {
    const fid = m.file_id ?? m.fileId;
    if (fid !== null && fid !== undefined && String(fid).trim() !== '' && (m.source_type || m.sourceType) !== 'model_questions') {
      const liveFile = liveFileById.get(String(fid));
      // If mapped file was deleted or marked deleted_at/hidden_at, never surface it
      if (!liveFile || liveFile.deleted_at || liveFile.hidden_at || ['removed', 'hidden'].includes(liveFile.moderation_status)) {
        return false;
      }
      if (authContext && typeof canReadResource === 'function') {
        if (!canReadResource(authContext, liveFile, 'note', { allowCrossSemester: true })) {
          return false;
        }
      }
    }
    if (!enforceCohortScope) return true;
    const mCohort = m.cohort_id !== undefined ? m.cohort_id : m.cohortId;
    if (mCohort === null || mCohort === undefined || String(mCohort).trim() === '') {
      // Teacher subject/semester restriction check when no file row or for PYQ
      if (callerRole === 'teacher' && authContext) {
        const fakeRow = {
          subject: courseTitle,
          semester_no: courseSemester,
          audience_scope: 'all_students',
          visibility: 'everyone'
        };
        return canReadResource(authContext, fakeRow, 'note', { allowCrossSemester: true });
      }
      return true;
    }
    if (callerRole === 'teacher' && authContext) {
      const fakeRow = {
        subject: courseTitle,
        semester_no: courseSemester,
        cohort_id: mCohort,
        audience_scope: 'cohort',
        visibility: 'everyone'
      };
      return canReadResource(authContext, fakeRow, 'note', { allowCrossSemester: true });
    }
    if (studentCohortId === null || studentCohortId === undefined) return false;
    return String(mCohort).trim() === String(studentCohortId).trim();
  };

  const mappingsByTopic = new Map();
  for (const m of mappingRows || []) {
    if (!isMappingVisibleToCaller(m)) continue;
    const tId = m.topic_id || m.topicId;
    if (!mappingsByTopic.has(tId)) mappingsByTopic.set(tId, []);
    mappingsByTopic.get(tId).push({
      id: m.id,
      cohortId: m.cohort_id ?? m.cohortId ?? null,
      sourceType: m.source_type || m.sourceType,
      fileId: m.file_id || m.fileId,
      fileTitle: m.file_title || m.fileTitle,
      chunkId: m.chunk_id || m.chunkId,
      extractedItemId: m.extracted_item_id || m.extractedItemId || null,
      pyqQuestionId: m.pyq_question_id || m.pyqQuestionId,
      pageStart: m.page_start ?? m.pageStart,
      pageEnd: m.page_end ?? m.pageEnd,
      sectionHeading: m.section_heading || m.sectionHeading,
      relevanceScore: Number(m.relevance_score ?? m.relevanceScore ?? 0.85),
      reviewStatus: m.review_status || m.reviewStatus || 'AUTO_APPROVED',
      conflictStatus: m.conflict_status || m.conflictStatus || 'NONE',
      curriculumVersion: Number(m.curriculum_version ?? m.curriculumVersion ?? 1),
      snippet: m.snippet || '',
      metadata: safeJsonParse(m.metadata_json || m.metadataJson, {})
    });
  }

  const topicsByUnit = new Map();
  for (const t of topicRows || []) {
    const uNum = Number(t.unit_number ?? t.unitNumber);
    if (!topicsByUnit.has(uNum)) topicsByUnit.set(uNum, []);
    const tMappings = mappingsByTopic.get(t.id) || [];

    const noteCitations = tMappings
      .filter((m) => m.sourceType === 'notes' || m.sourceType === 'practical' || m.sourceType === 'reference')
      .map((m) => ({
        fileId: m.fileId,
        fileTitle: m.fileTitle,
        chunkId: m.chunkId,
        pageStart: m.pageStart,
        pageEnd: m.pageEnd,
        sectionHeading: m.sectionHeading,
        sourceType: m.sourceType,
        reviewStatus: m.reviewStatus,
        snippet: m.snippet
      }));

    const pyqMatches = tMappings
      .filter((m) => m.sourceType === 'model_questions')
      .map((m) => ({
        id: m.pyqQuestionId || m.id,
        examYear: m.metadata?.examYear || 'Past Exam',
        examType: m.metadata?.examType || 'Final Exam',
        questionNumber: m.metadata?.questionNumber || '1',
        marks: m.metadata?.marks || 5,
        cleanText: m.snippet
      }));

    const toExtractedEntry = (m) => ({
      id: m.extractedItemId || m.id,
      itemType: m.sourceType,
      title: m.sectionHeading,
      contentText: m.snippet,
      fileId: m.fileId,
      fileTitle: m.fileTitle,
      pageStart: m.pageStart,
      pageEnd: m.pageEnd,
      reviewStatus: m.reviewStatus,
      conflictStatus: m.conflictStatus,
      structured: m.metadata
    });

    const extractedItems = {
      definitions: tMappings.filter((m) => m.sourceType === 'definition').map(toExtractedEntry),
      formulas: tMappings.filter((m) => m.sourceType === 'formula').map(toExtractedEntry),
      examples: tMappings.filter((m) => m.sourceType === 'code_example' || m.sourceType === 'worked_example').map(toExtractedEntry),
      diagrams: tMappings.filter((m) => m.sourceType === 'diagram').map(toExtractedEntry),
      tables: tMappings.filter((m) => m.sourceType === 'table').map(toExtractedEntry),
      inlineQuestions: tMappings.filter((m) => m.sourceType === 'inline_question').map(toExtractedEntry)
    };

    const topicConflicts = (reviewRows || [])
      .filter((r) => (r.candidate_topic_id || r.candidateTopicId) === t.id && (r.review_type || r.reviewType) === 'CROSS_FILE_CONFLICT')
      .map((r) => ({
        id: r.id,
        concept: r.extracted_concept || r.extractedConcept,
        primaryFileId: r.primary_file_id || r.primaryFileId,
        primaryFileTitle: r.primary_file_title || r.primaryFileTitle,
        primaryPageStart: r.primary_page_start ?? r.primaryPageStart,
        secondaryFileId: r.secondary_file_id || r.secondaryFileId,
        secondaryFileTitle: r.secondary_file_title || r.secondaryFileTitle,
        secondaryPageStart: r.secondary_page_start ?? r.secondaryPageStart,
        evidenceSummary: r.evidence_summary || r.evidenceSummary
      }));

    const hasNotesScoped = enforceCohortScope
      ? noteCitations.some((c) => c.sourceType === 'notes' || c.sourceType === 'reference') || extractedItems.definitions.length > 0
      : Boolean(t.has_notes ?? t.hasNotes);
    const hasPracticalScoped = enforceCohortScope
      ? noteCitations.some((c) => c.sourceType === 'practical') || extractedItems.examples.length > 0
      : Boolean(t.has_practical ?? t.hasPractical);
    const coverageStatusScoped = enforceCohortScope
      ? ((hasNotesScoped && hasPracticalScoped)
        ? 'COMPLETE'
        : hasNotesScoped
          ? 'NOTES_COVERED'
          : hasPracticalScoped
            ? 'PRACTICAL_ONLY'
            : 'MISSING_NOTES')
      : (t.coverage_status || t.coverageStatus);

    topicsByUnit.get(uNum).push({
      id: t.id,
      stepIndex: Number(t.step_index ?? t.stepIndex),
      topicCode: t.topic_code || t.topicCode,
      topicTitle: t.topic_title || t.topicTitle,
      normalizedTopic: t.normalized_topic || t.normalizedTopic,
      originType: t.origin_type || t.originType || 'official_syllabus',
      prerequisiteTopicIds: safeJsonParse(t.prerequisite_topic_ids_json || t.prerequisiteTopicIdsJson, []),
      curriculumVersion: Number(t.curriculum_version ?? t.curriculumVersion ?? 1),
      isLockedByTeacher: Boolean(t.is_locked_by_teacher ?? t.isLockedByTeacher),
      sourceOrigin: t.source_origin || t.sourceOrigin,
      coverageStatus: coverageStatusScoped,
      hasNotes: hasNotesScoped,
      hasPractical: hasPracticalScoped,
      hasPyq: Boolean(t.has_pyq ?? t.hasPyq),
      noteChunksCount: noteCitations.filter((c) => c.sourceType !== 'practical').length,
      practicalChunksCount: noteCitations.filter((c) => c.sourceType === 'practical').length,
      pyqCount: Number(t.pyq_count ?? t.pyqCount ?? 0),
      examWeightScore: Number(t.exam_weight_score ?? t.examWeightScore ?? 0),
      noteCitations,
      pyqMatches,
      extractedItems,
      conflicts: topicConflicts,
      mappings: tMappings
    });
  }

  const units = (unitRows || []).map((u) => {
    const uNum = Number(u.unit_number ?? u.unitNumber);
    const uTopics = topicsByUnit.get(uNum) || [];
    const totalTopics = uTopics.length || Number(u.total_topics ?? u.totalTopics ?? 0);
    const coveredTopics = enforceCohortScope
      ? uTopics.filter((t) => t.hasNotes || t.hasPractical).length
      : Number(u.covered_topics ?? u.coveredTopics ?? 0);
    const coverageRatio = totalTopics > 0 ? Number((coveredTopics / totalTopics).toFixed(3)) : 0;
    return {
      id: u.id,
      unitNumber: uNum,
      unitTitle: u.unit_title || u.unitTitle,
      teachingHours: Number(u.teaching_hours ?? u.teachingHours ?? 0),
      sourceOrigin: u.source_origin || u.sourceOrigin,
      syllabusFileId: u.syllabus_file_id || u.syllabusFileId || null,
      totalTopics,
      coveredTopics,
      missingTopicsCount: Math.max(0, totalTopics - coveredTopics),
      pyqQuestionsCount: Number(u.pyq_questions_count ?? u.pyqQuestionsCount ?? 0),
      coverageRatio,
      topics: uTopics
    };
  });

  const totalTopics = units.reduce((acc, u) => acc + u.totalTopics, 0);
  const coveredTopics = units.reduce((acc, u) => acc + u.coveredTopics, 0);
  const totalPyqs = units.reduce((acc, u) => acc + u.pyqQuestionsCount, 0);
  const missingTopics = units.flatMap((u) =>
    u.topics
      .filter((t) => t.coverageStatus === 'MISSING_NOTES')
      .map((t) => ({ unitNumber: u.unitNumber, topicCode: t.topicCode, topicTitle: t.topicTitle }))
  );

  const conflictsCount = (reviewRows || []).filter((r) => (r.review_type || r.reviewType) === 'CROSS_FILE_CONFLICT').length;

  return {
    subject: courseTitle,
    subjectCode: courseCode,
    semesterNo: courseSemester,
    units,
    reviewQueue: (reviewRows || []).map((r) => ({
      id: r.id,
      reviewType: r.review_type || r.reviewType,
      status: r.status,
      unitNumber: r.unit_number ?? r.unitNumber,
      candidateTopicId: r.candidate_topic_id || r.candidateTopicId,
      topicTitle: r.topic_title || r.topicTitle,
      extractedConcept: r.extracted_concept || r.extractedConcept,
      primaryFileId: r.primary_file_id || r.primaryFileId,
      primaryFileTitle: r.primary_file_title || r.primaryFileTitle,
      primaryPageStart: r.primary_page_start ?? r.primaryPageStart,
      secondaryFileId: r.secondary_file_id || r.secondaryFileId,
      secondaryFileTitle: r.secondary_file_title || r.secondary_file_title,
      secondaryPageStart: r.secondary_page_start ?? r.secondaryPageStart,
      confidence: Number(r.confidence ?? 0.75),
      evidenceSummary: r.evidence_summary || r.evidenceSummary,
      payload: safeJsonParse(r.payload_json || r.payloadJson, {})
    })),
    summary: {
      totalUnits: units.length,
      totalTopics,
      coveredTopics,
      missingTopicsCount: missingTopics.length,
      missingTopics,
      coverageRatio: totalTopics > 0 ? Number((coveredTopics / totalTopics).toFixed(3)) : 0,
      totalPyqs,
      reviewQueueCount: (reviewRows || []).length,
      conflictsCount
    }
  };
}

/**
 * Queries the KAIE Teacher Review Queue for uncertain syllabus mappings, unmapped note topics, and cross-file conflicts.
 */
async function getTeacherReviewQueue(db, filters = {}) {
  if (!db) return [];
  await ensureRagSchema(db);
  const clauses = [];
  const params = [];

  if (filters.subject) {
    clauses.push(`subject LIKE ?`);
    params.push(`%${filters.subject}%`);
  }
  if (filters.semesterNo) {
    clauses.push(`semester_no = ?`);
    params.push(Number(filters.semesterNo));
  }
  if (filters.unitNumber) {
    clauses.push(`unit_number = ?`);
    params.push(Number(filters.unitNumber));
  }
  if (filters.reviewType) {
    clauses.push(`review_type = ?`);
    params.push(String(filters.reviewType));
  }
  const statusFilter = filters.status || 'PENDING';
  if (statusFilter !== 'ALL') {
    clauses.push(`status = ?`);
    params.push(statusFilter);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT * FROM kaie_teacher_review_queue ${whereSql} ORDER BY created_at DESC LIMIT 100`,
    ...params
  );

  return (rows || []).map((r) => ({
    id: r.id,
    courseCode: r.course_code || r.courseCode,
    subject: r.subject,
    semesterNo: r.semester_no ?? r.semesterNo,
    unitNumber: r.unit_number ?? r.unitNumber,
    reviewType: r.review_type || r.reviewType,
    status: r.status,
    candidateTopicId: r.candidate_topic_id || r.candidateTopicId,
    topicTitle: r.topic_title || r.topicTitle,
    extractedConcept: r.extracted_concept || r.extractedConcept,
    primaryFileId: r.primary_file_id || r.primaryFileId,
    primaryFileTitle: r.primary_file_title || r.primaryFileTitle,
    primaryPageStart: r.primary_page_start ?? r.primaryPageStart,
    secondaryFileId: r.secondary_file_id || r.secondaryFileId,
    secondaryFileTitle: r.secondary_file_title || r.secondaryFileTitle,
    secondaryPageStart: r.secondary_page_start ?? r.secondaryPageStart,
    confidence: Number(r.confidence ?? 0.75),
    evidenceSummary: r.evidence_summary || r.evidenceSummary,
    payload: safeJsonParse(r.payload_json || r.payloadJson, {}),
    resolvedByUserId: r.resolved_by_user_id ?? r.resolvedByUserId ?? null,
    resolutionNote: r.resolution_note || r.resolutionNote || null,
    resolvedAt: r.resolved_at || r.resolvedAt || null
  }));
}

/**
 * Resolves a teacher review queue item (`action`: `'APPROVE'`, `'DISMISS'`, or `'LOCK_TOPIC'`)
 * and updates the underlying `course_syllabus_topics` / `topic_source_mappings` non-destructively.
 */
async function resolveTeacherReviewItem(db, reviewId, resolution = {}) {
  if (!db || !reviewId) return null;
  await ensureRagSchema(db);

  const row = await db.get(`SELECT * FROM kaie_teacher_review_queue WHERE id = ?`, [String(reviewId)]);
  if (!row) return null;

  const action = String(resolution.action || 'APPROVE').toUpperCase();
  const finalStatus = action === 'DISMISS' ? 'DISMISSED' : 'APPROVED';
  const now = new Date().toISOString();
  const topicId = resolution.targetTopicId || row.candidate_topic_id || row.candidateTopicId;

  await db.run(
    `UPDATE kaie_teacher_review_queue
     SET status = ?,
         candidate_topic_id = COALESCE(?, candidate_topic_id),
         resolved_by_user_id = ?,
         resolution_note = ?,
         resolved_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      finalStatus,
      topicId || null,
      resolution.resolvedByUserId ?? null,
      resolution.resolutionNote || null,
      now,
      now,
      String(reviewId)
    ]
  );

  if (finalStatus === 'APPROVED' && topicId) {
    await db.run(
      `UPDATE course_syllabus_topics
       SET is_locked_by_teacher = 1, updated_at = ?
       WHERE id = ?`,
      [now, topicId]
    );
    await db.run(
      `UPDATE topic_source_mappings
       SET review_status = 'TEACHER_APPROVED',
           conflict_status = CASE WHEN conflict_status = 'CONFLICT_DETECTED' THEN 'RESOLVED' ELSE conflict_status END
       WHERE topic_id = ? AND (file_id = ? OR file_id = ?)`,
      [
        topicId,
        String(row.primary_file_id || row.primaryFileId || ''),
        String(row.secondary_file_id || row.secondaryFileId || '')
      ]
    );
  } else if (finalStatus === 'DISMISSED' && topicId) {
    const payload = safeJsonParse(row.payload_json || row.payloadJson, {});
    if (payload.chunkId) {
      await db.run(
        `DELETE FROM topic_source_mappings WHERE topic_id = ? AND chunk_id = ?`,
        [topicId, payload.chunkId]
      );
    }
  }

  return (await getTeacherReviewQueue(db, { status: 'ALL' })).find((r) => r.id === String(reviewId)) || null;
}

/**
 * Returns the student's 5–6 enrolled semester subjects with live KAIE coverage,
 * extracted item counts, and PYQ counts without triggering expensive full rebuilds.
 */
async function getStudentAcademicWorkspace(db, options = {}) {
  if (!db) return { semesterNo: 1, courses: [] };
  await ensureRagSchema(db);

  const { getStudentEnrolledCourses } = require('./study-partner-reconciler');
  const semNo = parseSemesterNumber(
    options.semesterNo || options.academicContext?.cohort?.currentSemester || options.academicContext?.currentSemester
  ) || 1;

  const enrolled = getStudentEnrolledCourses(semNo);
  const unitRows = await db.all(
    `SELECT subject, COUNT(*) AS units_compiled,
            COALESCE(SUM(total_topics), 0) AS total_topics,
            COALESCE(SUM(covered_topics), 0) AS covered_topics,
            COALESCE(SUM(pyq_questions_count), 0) AS pyq_count
     FROM course_syllabus_units
     WHERE semester_no = ?
     GROUP BY subject`,
    semNo
  ).catch(() => []);

  const itemRows = await db.all(
    `SELECT subject, COUNT(*) AS items_count
     FROM academic_extracted_items
     WHERE semester_no = ?
     GROUP BY subject`,
    semNo
  ).catch(() => []);

  const unitBySub = new Map();
  for (const r of unitRows || []) {
    unitBySub.set(normalizeText(r.subject), r);
  }
  const itemsBySub = new Map();
  for (const r of itemRows || []) {
    itemsBySub.set(normalizeText(r.subject), Number(r.items_count ?? r.itemsCount ?? 0));
  }

  const courses = enrolled.map((c) => {
    const uStat = unitBySub.get(normalizeText(c.title));
    const totalTopics = Number(uStat?.total_topics ?? uStat?.totalTopics ?? 0);
    const coveredTopics = Number(uStat?.covered_topics ?? uStat?.coveredTopics ?? 0);
    const pyqCount = Number(uStat?.pyq_count ?? uStat?.pyqCount ?? 0);
    const extractedItemsCount = itemsBySub.get(normalizeText(c.title)) || 0;
    const coverageRatio = totalTopics > 0 ? Number((coveredTopics / totalTopics).toFixed(3)) : 0;

    return {
      code: c.code,
      title: c.title,
      semesterNo: c.semesterNo,
      unitsCount: c.unitsCount,
      compiledUnitsCount: Number(uStat?.units_compiled ?? uStat?.unitsCompiled ?? 0),
      totalTopics,
      coveredTopics,
      coverageRatio,
      pyqCount,
      extractedItemsCount
    };
  });

  return {
    semesterNo: semNo,
    coursesCount: courses.length,
    courses
  };
}

module.exports = {
  parseUploadedSyllabusText,
  classifyChunkResourceCategory,
  computeExtractedItemTopicScore,
  detectCrossFileConflicts,
  syncCourseMap,
  getCourseMap,
  getStudentAcademicWorkspace,
  getTeacherReviewQueue,
  resolveTeacherReviewItem
};
