'use strict';

const { ensureRagSchema } = require('./rag-schema');
const {
  normalizeText,
  parseSemesterNumber,
  loadSyllabusRegistry,
  CONCEPT_TAXONOMY
} = require('./academic-document-understanding');
const { searchPyqQuestions } = require('./pyq-intelligence');

/**
 * Resolves a course and unit/chapter from student inputs, scoping by semester when available.
 */
function resolveCourseAndChapter(subjectQuery, chapterQuery, semesterNo = null) {
  const registry = loadSyllabusRegistry();
  const sem = parseSemesterNumber(semesterNo);
  const normSub = normalizeText(subjectQuery || '');
  const normChap = normalizeText(chapterQuery || '');

  // Filter courses by semester if specified, otherwise consider all courses
  let candidateCourses = sem
    ? registry.courses.filter((c) => c.semesterNo === sem)
    : registry.courses;

  if (candidateCourses.length === 0) {
    candidateCourses = registry.courses;
  }

  // Parse chapter / unit number early
  let targetUnitNumber = null;
  const numMatch = String(chapterQuery || subjectQuery || '').match(/\b(?:unit|chapter|ch\.?|u\.?)\s*(\d{1,2})\b/i);
  if (numMatch) {
    targetUnitNumber = Number(numMatch[1]);
  } else {
    const rawDigitMatch = String(chapterQuery || '').match(/\b(\d{1,2})\b/);
    if (rawDigitMatch) {
      targetUnitNumber = Number(rawDigitMatch[1]);
    }
  }

  // Find best matching course
  let matchedCourse = null;
  if (normSub) {
    // 1. Exact match on title or code
    matchedCourse = candidateCourses.find(
      (c) => c.normalizedTitle === normSub || normalizeText(c.code) === normSub
    );

    // 2. Acronym or nickname match (e.g. "dsa", "c", "dbms", "os", "css")
    if (!matchedCourse) {
      if (normSub === 'dsa' || normSub.includes('dsa')) {
        matchedCourse = candidateCourses.find((c) => normalizeText(c.code) === 'cit214' || c.normalizedTitle.includes('data structure'));
      } else if (normSub === 'c' || normSub === 'c programming') {
        matchedCourse = candidateCourses.find((c) => normalizeText(c.code) === 'cit111' || c.normalizedTitle.includes('computer programming i'));
      } else if (normSub === 'dbms' || normSub.includes('dbms')) {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('database'));
      } else if (normSub === 'os' || normSub === 'operating system' || normSub === 'operating systems') {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('operating system'));
      } else if (normSub === 'web' || normSub === 'web tech' || normSub === 'css' || normSub.includes('css') || normSub.includes('cascading style')) {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('web technology'));
        if ((normSub === 'css' || normSub.includes('css')) && !targetUnitNumber) {
          targetUnitNumber = 3;
        }
      }
    }

    // 2.5 Curriculum reasoning fallback for concepts
    if (!matchedCourse) {
      try {
        const { reasonCurriculum } = require('./curriculum-reasoning');
        const reasoned = reasonCurriculum(subjectQuery || chapterQuery);
        if (reasoned && reasoned.found && reasoned.candidateSubjects && reasoned.candidateSubjects.length > 0) {
          const bestSubj = reasoned.candidateSubjects[0];
          matchedCourse = candidateCourses.find(c => c.title === bestSubj || normalizeText(c.title) === normalizeText(bestSubj)) || registry.courses.find(c => c.title === bestSubj);
          if (reasoned.units && reasoned.units.length > 0 && !targetUnitNumber) {
            const topU = reasoned.units.find(u => u.courseTitle === matchedCourse?.title) || reasoned.units[0];
            if (topU) targetUnitNumber = topU.unitNumber;
          }
        }
      } catch (_) {}
    }

    // 3. Substring match
    if (!matchedCourse) {
      matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle));
    }
  }

  // If still not matched, try searching all courses without semester filter
  if (!matchedCourse && normSub) {
    matchedCourse = registry.courses.find(
      (c) => c.normalizedTitle.includes(normSub) || normalizeText(c.code) === normSub
    );
  }

  // Default fallback if no course found
  if (!matchedCourse) {
    matchedCourse = candidateCourses[0] || registry.courses[0];
  }

  // Parse chapter / unit number if not already determined
  if (!targetUnitNumber) {
    const numMatch = String(chapterQuery || '').match(/\b(?:unit|chapter|ch\.?|u\.?)\s*(\d{1,2})\b/i);
    if (numMatch) {
      targetUnitNumber = Number(numMatch[1]);
    } else {
      const rawDigitMatch = String(chapterQuery || '').match(/\b(\d{1,2})\b/);
      if (rawDigitMatch) {
        targetUnitNumber = Number(rawDigitMatch[1]);
      }
    }
  }

  // If no digit, check unit title substring
  let matchedUnit = null;
  if (targetUnitNumber && matchedCourse.units) {
    matchedUnit = matchedCourse.units.find((u) => u.unitNumber === targetUnitNumber);
  }
  if (!matchedUnit && normChap && matchedCourse.units) {
    matchedUnit = matchedCourse.units.find((u) => {
      const uNorm = normalizeText(u.title);
      return uNorm.includes(normChap) || normChap.includes(uNorm);
    });
  }

  // Fallback to unit 1 if nothing matched
  if (!matchedUnit && matchedCourse.units && matchedCourse.units.length > 0) {
    matchedUnit = matchedCourse.units[0];
  }

  return {
    course: matchedCourse,
    unit: matchedUnit,
    unitNumber: matchedUnit ? matchedUnit.unitNumber : 1,
    chapterTitle: matchedUnit ? matchedUnit.title : (chapterQuery || 'Chapter 1'),
    syllabusSubtopics: matchedUnit ? (matchedUnit.topics || []) : []
  };
}

/**
 * Builds an exhaustive, zero-topic-left-behind study plan for a chapter/unit
 * by reconciling official syllabus subtopics with uploaded teacher note sections and PYQs.
 */
async function buildReconciledStudyPlan(db, options = {}) {
  const {
    subject,
    chapterQuery,
    semesterNo,
    unitNumber,
    fileId
  } = options;

  // 1. Resolve official course, unit, and syllabus subtopics
  const resolved = resolveCourseAndChapter(subject, chapterQuery || (unitNumber ? `Unit ${unitNumber}` : 'Unit 1'), semesterNo);
  const targetCourse = resolved.course;
  const targetUnit = resolved.unit;
  const finalUnitNum = unitNumber !== undefined && unitNumber !== null ? Number(unitNumber) : resolved.unitNumber;
  const finalChapterTitle = targetUnit ? targetUnit.title : resolved.chapterTitle;
  const officialSubtopics = targetUnit ? [...targetUnit.topics] : [];

  // 2. Fetch all authorized teacher notes for this subject and unit/chapter
  let teacherNoteSections = [];
  const sourceFiles = new Map(); // fileId -> { fileId, title, pageCount, chunksCount }

  if (db && typeof db.all === 'function') {
    try {
      await ensureRagSchema(db);

      // Search `files` and `document_topic_metadata`
      const fileQueryParams = [`%${targetCourse.title}%`, `%${targetCourse.code}%`];
      let fileFilterSql = `(f.subject LIKE ? OR f.subject LIKE ?)`;
      if (targetCourse.semesterNo) {
        fileFilterSql += ` AND (f.semester_no = ? OR f.semester_no IS NULL)`;
        fileQueryParams.push(targetCourse.semesterNo);
      }
      if (fileId) {
        fileFilterSql = `f.id = ?`;
        fileQueryParams.length = 0;
        fileQueryParams.push(fileId);
      }

      // Fetch note chunks for this chapter/unit
      const chunkQueryParams = [...fileQueryParams, `%${finalUnitNum}%`, `%${finalChapterTitle}%`];
      const chunkSql = `
        SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end,
               c.section_heading, c.heading_path, c.clean_content, c.topics_json,
               f.title as file_title, f.originalName as original_name
        FROM document_chunks c
        JOIN files f ON f.id = CAST(c.file_id AS INTEGER)
        WHERE ${fileFilterSql}
          AND (c.unit LIKE ? OR c.chapter LIKE ? OR c.section_heading LIKE ? OR c.clean_content LIKE ?)
        ORDER BY c.file_id, c.page_start ASC, c.chunk_index ASC
      `;
      chunkQueryParams.push(`%${finalChapterTitle}%`, `%${finalChapterTitle}%`);

      const chunks = await db.all(chunkSql, ...chunkQueryParams);

      for (const ch of chunks || []) {
        const fId = String(ch.file_id || ch.fileId);
        if (!sourceFiles.has(fId)) {
          sourceFiles.set(fId, {
            fileId: fId,
            title: ch.file_title || ch.original_name || `Teacher Note #${fId}`,
            pageStart: ch.page_start,
            pageEnd: ch.page_end
          });
        }

        const heading = (ch.section_heading || '').trim();
        if (heading && heading.length >= 3) {
          teacherNoteSections.push({
            heading,
            normalizedHeading: normalizeText(heading),
            fileId: fId,
            fileTitle: ch.file_title || ch.original_name,
            chunkId: ch.id,
            pageStart: ch.page_start,
            pageEnd: ch.page_end,
            topics: safeJsonParse(ch.topics_json, []),
            snippet: (ch.clean_content || '').slice(0, 300)
          });
        }
      }

      // If no chunks matched the narrow chapter filter, fetch chunks for this subject's file
      if (teacherNoteSections.length === 0) {
        const fallbackChunks = await db.all(
          `SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end,
                  c.section_heading, c.heading_path, c.clean_content, c.topics_json,
                  f.title as file_title, f.originalName as original_name
           FROM document_chunks c
           JOIN files f ON f.id = CAST(c.file_id AS INTEGER)
           WHERE ${fileFilterSql}
           ORDER BY c.file_id, c.page_start ASC, c.chunk_index ASC
           LIMIT 25`,
          ...fileQueryParams
        );

        for (const ch of fallbackChunks || []) {
          const fId = String(ch.file_id || ch.fileId);
          if (!sourceFiles.has(fId)) {
            sourceFiles.set(fId, {
              fileId: fId,
              title: ch.file_title || ch.original_name || `Teacher Note #${fId}`,
              pageStart: ch.page_start,
              pageEnd: ch.page_end
            });
          }
          const heading = (ch.section_heading || '').trim();
          if (heading && heading.length >= 3) {
            teacherNoteSections.push({
              heading,
              normalizedHeading: normalizeText(heading),
              fileId: fId,
              fileTitle: ch.file_title || ch.original_name,
              chunkId: ch.id,
              pageStart: ch.page_start,
              pageEnd: ch.page_end,
              topics: safeJsonParse(ch.topics_json, []),
              snippet: (ch.clean_content || '').slice(0, 300)
            });
          }
        }
      }
    } catch (e) {
      // Graceful fallback if tables or indexes are still loading
    }
  }

  // 3. Query Past Year Questions (PYQs) for this subject and unit
  let pyqList = [];
  if (db && typeof db.all === 'function') {
    try {
      pyqList = await searchPyqQuestions(db, {
        subject: targetCourse.title,
        subjectCode: targetCourse.code,
        semesterNo: targetCourse.semesterNo,
        unitNumber: finalUnitNum,
        limit: 30
      });
    } catch (_) {}
  }

  // 4. Bipartite Alignment: Merge Syllabus Subtopics & Teacher Note Sections
  // Guarantees ZERO topics left behind from either syllabus or teacher PDF!
  const reconciledSteps = [];
  const matchedNoteHeadingIndices = new Set();

  for (let sIdx = 0; sIdx < officialSubtopics.length; sIdx++) {
    const sylTopic = officialSubtopics[sIdx];
    const normSyl = normalizeText(sylTopic);

    // Find all matching teacher note sections for this syllabus topic
    const matchingNotes = [];
    for (let nIdx = 0; nIdx < teacherNoteSections.length; nIdx++) {
      const noteSec = teacherNoteSections[nIdx];
      const matchScore = computeTopicSimilarity(normSyl, noteSec.normalizedHeading, noteSec.topics);
      if (matchScore >= 0.5) {
        matchingNotes.push(noteSec);
        matchedNoteHeadingIndices.add(nIdx);
      }
    }

    // Match any PYQs for this micro-topic
    const matchedPyqs = pyqList.filter((q) => {
      const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || q.question_text || q.questionText || '');
      const topicNorm = normalizeText(q.primary_topic || q.primaryTopic || '');
      if (qNorm.includes(normSyl) || topicNorm === normSyl) return true;
      const sim = computeTopicSimilarity(normSyl, qNorm);
      if (sim >= 0.5) return true;
      const sylWords = normSyl.split(/\s+/).filter(w => w.length >= 4 && !/^(?:list|lists)$/.test(w));
      if (sylWords.length >= 2 && sylWords.every(w => qNorm.includes(w.replace(/s$/, '')) || qNorm.includes(w.replace(/ing$/, '')) || qNorm.includes(w.replace(/tion$/, '')))) return true;
      return false;
    });

    // Create reconciled step for this syllabus topic
    const stepSourceOrigin = matchingNotes.length > 0 ? 'syllabus_and_note' : 'syllabus_only';
    reconciledSteps.push({
      topicTitle: sylTopic,
      normalizedTopic: normSyl,
      sourceOrigin: stepSourceOrigin,
      syllabusRef: `${finalUnitNum}.${sIdx + 1} ${sylTopic}`,
      noteCitations: matchingNotes.map((m) => ({
        fileId: m.fileId,
        fileTitle: m.fileTitle,
        chunkId: m.chunkId,
        pageStart: m.pageStart,
        pageEnd: m.pageEnd,
        sectionHeading: m.heading
      })),
      pyqMatches: matchedPyqs.map((q) => ({
        id: q.id,
        examYear: q.exam_year || q.examYear,
        examType: q.exam_type || q.examType,
        questionNumber: q.question_number || q.questionNumber,
        marks: q.marks,
        cleanText: q.clean_question_text || q.cleanQuestionText || q.question_text || q.questionText
      })),
      hasPyqAlert: matchedPyqs.length > 0
    });

    // Insert any unmatched teacher note sections that appeared between this syllabus topic and the next
    // so that extra teacher sections (e.g. derivations, code variations, dry runs) are NOT skipped!
    for (let nIdx = 0; nIdx < teacherNoteSections.length; nIdx++) {
      if (!matchedNoteHeadingIndices.has(nIdx)) {
        const unmatch = teacherNoteSections[nIdx];
        // Check if this unmatch is contextually related to current syllabus topic
        const isRelated = computeTopicSimilarity(normSyl, unmatch.normalizedHeading, unmatch.topics) >= 0.3;
        if (isRelated) {
          matchedNoteHeadingIndices.add(nIdx);

          const matchedPyqsExtra = pyqList.filter((q) => {
            const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || '');
            return qNorm.includes(unmatch.normalizedHeading);
          });

          reconciledSteps.push({
            topicTitle: unmatch.heading,
            normalizedTopic: unmatch.normalizedHeading,
            sourceOrigin: 'note_exclusive',
            syllabusRef: `Teacher Note Extra (Under ${finalUnitNum}.${sIdx + 1})`,
            noteCitations: [{
              fileId: unmatch.fileId,
              fileTitle: unmatch.fileTitle,
              chunkId: unmatch.chunkId,
              pageStart: unmatch.pageStart,
              pageEnd: unmatch.pageEnd,
              sectionHeading: unmatch.heading
            }],
            pyqMatches: matchedPyqsExtra.map((q) => ({
              id: q.id,
              examYear: q.exam_year || q.examYear,
              examType: q.exam_type || q.examType,
              questionNumber: q.question_number || q.questionNumber,
              marks: q.marks,
              cleanText: q.clean_question_text || q.cleanQuestionText || q.question_text || q.questionText
            })),
            hasPyqAlert: matchedPyqsExtra.length > 0
          });
        }
      }
    }
  }

  // Include any remaining unmatched note sections at the end of the chapter
  for (let nIdx = 0; nIdx < teacherNoteSections.length; nIdx++) {
    if (!matchedNoteHeadingIndices.has(nIdx)) {
      const remainingSec = teacherNoteSections[nIdx];
      matchedNoteHeadingIndices.add(nIdx);

      const matchedPyqsRemaining = pyqList.filter((q) => {
        const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || '');
        return qNorm.includes(remainingSec.normalizedHeading);
      });

      reconciledSteps.push({
        topicTitle: remainingSec.heading,
        normalizedTopic: remainingSec.normalizedHeading,
        sourceOrigin: 'note_exclusive',
        syllabusRef: `Teacher Note Section (Unit ${finalUnitNum})`,
        noteCitations: [{
          fileId: remainingSec.fileId,
          fileTitle: remainingSec.fileTitle,
          chunkId: remainingSec.chunkId,
          pageStart: remainingSec.pageStart,
          pageEnd: remainingSec.pageEnd,
          sectionHeading: remainingSec.heading
        }],
        pyqMatches: matchedPyqsRemaining.map((q) => ({
          id: q.id,
          examYear: q.exam_year || q.examYear,
          examType: q.exam_type || q.examType,
          questionNumber: q.question_number || q.questionNumber,
          marks: q.marks,
          cleanText: q.clean_question_text || q.cleanQuestionText || q.question_text || q.questionText
        })),
        hasPyqAlert: matchedPyqsRemaining.length > 0
      });
    }
  }

  // Number the sequential steps 1..N
  const orderedPlan = reconciledSteps.map((step, idx) => ({
    stepIndex: idx + 1,
    ...step
  }));

  const pyqAlertsCount = orderedPlan.filter((s) => s.hasPyqAlert).length;
  const noteExclusiveCount = orderedPlan.filter((s) => s.sourceOrigin === 'note_exclusive').length;
  const syllabusCount = orderedPlan.filter((s) => s.sourceOrigin === 'syllabus_and_note' || s.sourceOrigin === 'syllabus_only').length;

  return {
    subject: targetCourse.title,
    subjectCode: targetCourse.code,
    semesterNo: targetCourse.semesterNo,
    unitNumber: finalUnitNum,
    chapterTitle: finalChapterTitle,
    teachingHours: targetUnit ? targetUnit.teachingHours : null,
    totalSteps: orderedPlan.length,
    plan: orderedPlan,
    summary: {
      totalSteps: orderedPlan.length,
      syllabusTopicsCount: syllabusCount,
      noteExclusiveCount,
      pyqAlertsCount,
      totalPyqsMatched: pyqList.length,
      sourceFiles: Array.from(sourceFiles.values())
    }
  };
}

/**
 * Computes semantic token overlap and taxonomy similarity between a syllabus topic and a note heading.
 */
function computeTopicSimilarity(normSyllabus, normHeading, noteTopics = []) {
  if (!normSyllabus || !normHeading) return 0;
  if (normSyllabus === normHeading) return 1.0;

  const operations = ['insert', 'insertion', 'delete', 'deletion', 'reverse', 'reversing', 'search', 'searching', 'traverse', 'traversal', 'sort', 'sorting', 'malloc', 'dynamic memory'];
  const sylOps = operations.filter(op => normSyllabus.includes(op));
  const headOps = operations.filter(op => normHeading.includes(op));

  // If both have specific operations but they conflict (e.g. reverse vs insert), they are distinct micro-topics!
  if (sylOps.length > 0 && headOps.length > 0 && !sylOps.some(o => headOps.includes(o))) {
    return 0.2;
  }

  if (normHeading.includes(normSyllabus) || normSyllabus.includes(normHeading)) {
    return 0.85;
  }

  const sylTokens = new Set(normSyllabus.split(/\s+/).filter((t) => t.length >= 3));
  const headTokens = new Set(normHeading.split(/\s+/).filter((t) => t.length >= 3));

  let overlap = 0;
  for (const t of sylTokens) {
    if (headTokens.has(t)) overlap++;
  }

  const dice = (2 * overlap) / (sylTokens.size + headTokens.size);
  if (dice >= 0.6) {
    return 0.8;
  }
  if (sylTokens.size > 0 && overlap / sylTokens.size >= 0.7) {
    return 0.75;
  }

  // Check CONCEPT_TAXONOMY aliases
  for (const c of CONCEPT_TAXONOMY) {
    const hasSyl = c.aliases.some((a) => normSyllabus.includes(a));
    const hasHead = c.aliases.some((a) => normHeading.includes(a));
    if (hasSyl && hasHead) return 0.9;
  }

  return 0.1;
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

module.exports = {
  resolveCourseAndChapter,
  buildReconciledStudyPlan,
  computeTopicSimilarity
};
