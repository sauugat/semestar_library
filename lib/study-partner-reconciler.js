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
 * Returns the 5–6 official BIT courses for a given student semester number.
 */
function getStudentEnrolledCourses(semesterNo) {
  const registry = loadSyllabusRegistry();
  const sem = parseSemesterNumber(semesterNo);
  if (!sem) return [];
  return (registry.courses || [])
    .filter((c) => c.semesterNo === sem)
    .map((c) => ({
      code: c.code,
      title: c.title,
      semesterNo: c.semesterNo,
      unitsCount: Array.isArray(c.units) ? c.units.length : 0
    }));
}

/**
 * Searches a list of courses for a unit/topic matching a query string (e.g. "infinite series", "bcnf", "css selectors").
 */
function findCourseAndUnitByTopicQuery(courses = [], rawQuery = '') {
  const normQ = normalizeText(rawQuery)
    .replace(/\b(?:teach\s+me|learn|study|explain|start|chapter|unit|course|subject|in|of|about|for|from|basics?|introduction\s+to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normQ || normQ.length < 3) return null;

  let bestMatch = null;
  let bestScore = 0;

  const isMeaningfulSubstringMatch = (candidateNorm) => {
    if (!candidateNorm || candidateNorm.length < 4 || normQ.length < 4) return false;
    if (!candidateNorm.includes(normQ) && !normQ.includes(candidateNorm)) return false;
    const shorter = candidateNorm.length <= normQ.length ? candidateNorm : normQ;
    return shorter.length >= Math.ceil(normQ.length * 0.6);
  };

  for (const course of courses) {
    for (const unit of course.units || []) {
      const uNorm = normalizeText(unit.title);
      if (uNorm && (uNorm === normQ || isMeaningfulSubstringMatch(uNorm))) {
        const score = uNorm === normQ ? 12 : 9;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { course, unit, matchedTopic: unit.title, score };
        }
      }
      for (const topic of unit.topics || []) {
        const tNorm = normalizeText(topic);
        if (!tNorm || tNorm.length < 3) continue;
        if (tNorm === normQ) {
          return { course, unit, matchedTopic: topic, score: 15 };
        }
        if (isMeaningfulSubstringMatch(tNorm)) {
          const score = 8;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { course, unit, matchedTopic: topic, score };
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Resolves a course and unit/chapter from student inputs, scoping by the student's enrolled semester (5–6 subjects) first.
 * Also reports `scopeStatus` ('IN_ENROLLED_SCOPE' | 'CROSS_SEMESTER_SYLLABUS' | 'OUT_OF_SYLLABUS')
 * so Study Partner never silently pretends an out-of-scope topic belongs to an unrelated course.
 */
function resolveCourseAndChapter(subjectQuery, chapterQuery, semesterNo = null) {
  const registry = loadSyllabusRegistry();
  const sem = parseSemesterNumber(semesterNo);
  const normSub = normalizeText(subjectQuery || '');
  const normChap = normalizeText(chapterQuery || '');

  const enrolledCourses = sem
    ? registry.courses.filter((c) => c.semesterNo === sem)
    : [];
  const candidateCourses = enrolledCourses.length > 0 ? enrolledCourses : registry.courses;

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

  let matchedCourse = null;
  let matchedUnitFromTopic = null;
  let scopeStatus = 'IN_ENROLLED_SCOPE';

  if (normSub) {
    // 1. Exact match on title or code within enrolled semester
    matchedCourse = candidateCourses.find(
      (c) => c.normalizedTitle === normSub || normalizeText(c.code) === normSub
    );

    // 2. Acronym or nickname match within enrolled semester (or global if unambiguous)
    if (!matchedCourse) {
      if (normSub === 'dsa' || normSub.includes('dsa')) {
        matchedCourse = candidateCourses.find((c) => normalizeText(c.code) === 'cit214' || c.normalizedTitle.includes('data structure'))
          || registry.courses.find((c) => normalizeText(c.code) === 'cit214' || c.normalizedTitle.includes('data structure'));
      } else if (normSub === 'c' || normSub === 'c programming') {
        matchedCourse = candidateCourses.find((c) => normalizeText(c.code) === 'cit111' || c.normalizedTitle.includes('computer programming i'))
          || registry.courses.find((c) => normalizeText(c.code) === 'cit111' || c.normalizedTitle.includes('computer programming i'));
      } else if (normSub === 'dbms' || normSub.includes('dbms')) {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('database'))
          || registry.courses.find((c) => c.normalizedTitle.includes('database'));
      } else if (normSub === 'os' || normSub === 'operating system' || normSub === 'operating systems') {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('operating system'))
          || registry.courses.find((c) => c.normalizedTitle.includes('operating system'));
      } else if (normSub === 'web' || normSub === 'web tech' || normSub === 'css' || normSub.includes('css') || normSub.includes('cascading style')) {
        matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes('web technology'))
          || registry.courses.find((c) => c.normalizedTitle.includes('web technology'));
        if ((normSub === 'css' || normSub.includes('css')) && !targetUnitNumber) {
          targetUnitNumber = matchedCourse && matchedCourse.code === 'CIT211' ? 2 : 3;
        }
      }
    }

    // 3. Substring match on course title within enrolled semester
    if (!matchedCourse) {
      matchedCourse = candidateCourses.find((c) => c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle));
    }

    // 4. Search syllabus unit/topic titles within the student's 5-6 enrolled semester courses first!
    if (!matchedCourse) {
      const enrolledTopicHit = findCourseAndUnitByTopicQuery(candidateCourses, `${subjectQuery || ''} ${chapterQuery || ''}`);
      if (enrolledTopicHit) {
        matchedCourse = enrolledTopicHit.course;
        matchedUnitFromTopic = enrolledTopicHit.unit;
        if (!targetUnitNumber && matchedUnitFromTopic) {
          targetUnitNumber = matchedUnitFromTopic.unitNumber;
        }
      }
    }

    // 5. Curriculum reasoning or cross-semester course/topic lookup
    if (!matchedCourse) {
      try {
        const { reasonCurriculum } = require('./curriculum-reasoning');
        const reasoned = reasonCurriculum(subjectQuery || chapterQuery);
        if (reasoned && reasoned.found && reasoned.candidateSubjects && reasoned.candidateSubjects.length > 0) {
          const bestSubj = reasoned.candidateSubjects[0];
          matchedCourse = candidateCourses.find((c) => c.title === bestSubj || normalizeText(c.title) === normalizeText(bestSubj))
            || registry.courses.find((c) => c.title === bestSubj || normalizeText(c.title) === normalizeText(bestSubj));
          if (reasoned.units && reasoned.units.length > 0 && !targetUnitNumber) {
            const topU = reasoned.units.find((u) => u.courseTitle === matchedCourse?.title) || reasoned.units[0];
            if (topU) targetUnitNumber = topU.unitNumber;
          }
        }
      } catch (_) {}
    }

    if (!matchedCourse) {
      matchedCourse = registry.courses.find(
        (c) => c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle) || normalizeText(c.code) === normSub
      );
    }

    if (!matchedCourse) {
      const globalTopicHit = findCourseAndUnitByTopicQuery(registry.courses, `${subjectQuery || ''} ${chapterQuery || ''}`);
      if (globalTopicHit) {
        matchedCourse = globalTopicHit.course;
        matchedUnitFromTopic = globalTopicHit.unit;
        if (!targetUnitNumber && matchedUnitFromTopic) {
          targetUnitNumber = matchedUnitFromTopic.unitNumber;
        }
      }
    }
  }

  if (matchedCourse) {
    if (sem && matchedCourse.semesterNo && matchedCourse.semesterNo !== sem) {
      scopeStatus = 'CROSS_SEMESTER_SYLLABUS';
    } else {
      scopeStatus = 'IN_ENROLLED_SCOPE';
    }
  } else {
    scopeStatus = normSub ? 'OUT_OF_SYLLABUS' : 'IN_ENROLLED_SCOPE';
    matchedCourse = candidateCourses[0] || registry.courses[0];
  }

  if (!targetUnitNumber) {
    const unitMatch = String(chapterQuery || '').match(/\b(?:unit|chapter|ch\.?|u\.?)\s*(\d{1,2})\b/i);
    if (unitMatch) {
      targetUnitNumber = Number(unitMatch[1]);
    } else {
      const rawDigitMatch = String(chapterQuery || '').match(/\b(\d{1,2})\b/);
      if (rawDigitMatch) {
        targetUnitNumber = Number(rawDigitMatch[1]);
      }
    }
  }

  let matchedUnit = matchedUnitFromTopic || null;
  if (!matchedUnit && targetUnitNumber && matchedCourse.units) {
    matchedUnit = matchedCourse.units.find((u) => u.unitNumber === targetUnitNumber);
  }
  if (!matchedUnit && normChap && matchedCourse.units) {
    matchedUnit = matchedCourse.units.find((u) => {
      const uNorm = normalizeText(u.title);
      return uNorm.includes(normChap) || normChap.includes(uNorm);
    });
  }
  if (!matchedUnit && matchedCourse.units && matchedCourse.units.length > 0) {
    matchedUnit = matchedCourse.units[0];
  }

  return {
    course: matchedCourse,
    unit: matchedUnit,
    unitNumber: matchedUnit ? matchedUnit.unitNumber : 1,
    chapterTitle: matchedUnit ? matchedUnit.title : (chapterQuery || 'Chapter 1'),
    syllabusSubtopics: matchedUnit ? (matchedUnit.topics || []) : [],
    scopeStatus,
    requestedSemesterNo: sem || null,
    enrolledSemesterCourses: enrolledCourses.map((c) => ({
      code: c.code,
      title: c.title,
      semesterNo: c.semesterNo
    }))
  };
}

function isGenericNoteHeading(heading) {
  const clean = String(heading || '').trim();
  if (!clean || clean.length < 3 || clean.length > 100) return true;
  if (/^\d+$/.test(clean)) return true;
  if (/^(?:page|pg\.?|slide|sheet|unit|chapter|ch\.?|module|part|section|sec\.?|figure|fig\.?|table)\s*\d*$/i.test(clean)) return true;
  if (/^(?:table\s+of\s+contents|contents|index|references?|bibliography|appendix|acknowledg?ments?|preface|overview|summary|untitled|notes?)$/i.test(clean)) return true;
  return false;
}

function cleanSyllabusTopic(rawTopic) {
  let topic = String(rawTopic || '').trim();
  if (!topic) return null;
  topic = topic.replace(/\s+After completing\b[\s\S]*$/i, '').trim();
  if (!topic || topic.length < 2) return null;
  if (/^(?:after completing|students will|program with different|at the end of|learning outcomes?:|objectives?:)/i.test(topic)) {
    return null;
  }
  if (/should be developed\.?$/i.test(topic)) {
    return null;
  }
  return topic;
}

/**
 * Builds an exhaustive, zero-topic-left-behind study plan for a chapter/unit
 * by reconciling official syllabus subtopics with uploaded teacher note sections, extracted items, and PYQs.
 */
async function buildReconciledStudyPlan(db, options = {}) {
  const {
    subject,
    chapterQuery,
    semesterNo,
    unitNumber,
    fileId,
    academicContext
  } = options;

  const resolved = resolveCourseAndChapter(subject, chapterQuery || (unitNumber ? `Unit ${unitNumber}` : 'Unit 1'), semesterNo);
  const targetCourse = resolved.course;
  const targetUnit = resolved.unit;
  const finalUnitNum = unitNumber !== undefined && unitNumber !== null ? Number(unitNumber) : resolved.unitNumber;
  const finalChapterTitle = targetUnit ? targetUnit.title : resolved.chapterTitle;

  if (!fileId && db && typeof db.all === 'function') {
    try {
      const { getCourseMap } = require('./kaie-course-map');
      const courseMap = await getCourseMap(db, {
        subject: targetCourse.title,
        semesterNo: targetCourse.semesterNo,
        unitNumber: finalUnitNum,
        academicContext
      });
      const mappedUnit = courseMap && Array.isArray(courseMap.units)
        ? courseMap.units.find((u) => Number(u.unitNumber) === Number(finalUnitNum))
        : null;
      if (mappedUnit && Array.isArray(mappedUnit.topics) && mappedUnit.topics.length > 0) {
        const sourceFilesMap = new Map();
        const orderedPlan = mappedUnit.topics.map((t, idx) => {
          for (const cit of t.noteCitations || []) {
            if (cit.fileId && !sourceFilesMap.has(String(cit.fileId))) {
              sourceFilesMap.set(String(cit.fileId), {
                fileId: String(cit.fileId),
                title: cit.fileTitle || `Teacher Note #${cit.fileId}`,
                pageStart: cit.pageStart || 1,
                pageEnd: cit.pageEnd || 1
              });
            }
          }
          return {
            stepIndex: idx + 1,
            topicId: t.id,
            topicTitle: t.topicTitle,
            normalizedTopic: t.normalizedTopic,
            originType: t.originType || 'official_syllabus',
            prerequisiteTopicIds: t.prerequisiteTopicIds || [],
            sourceOrigin: t.sourceOrigin,
            coverageStatus: t.coverageStatus,
            syllabusRef: t.sourceOrigin === 'note_exclusive'
              ? `Teacher Note Section (Unit ${finalUnitNum})`
              : `${t.topicCode || `${finalUnitNum}.${idx + 1}`} ${t.topicTitle}`,
            noteCitations: t.noteCitations || [],
            pyqMatches: t.pyqMatches || [],
            extractedItems: t.extractedItems || {
              definitions: [],
              formulas: [],
              examples: [],
              diagrams: [],
              tables: [],
              inlineQuestions: []
            },
            conflicts: t.conflicts || [],
            hasPyqAlert: Boolean(t.hasPyq),
            examWeightScore: t.examWeightScore || 0
          };
        });

        const pyqAlertsCount = orderedPlan.filter((s) => s.hasPyqAlert).length;
        const noteExclusiveCount = orderedPlan.filter((s) => s.sourceOrigin === 'note_exclusive').length;
        const syllabusCount = orderedPlan.length - noteExclusiveCount;

        return {
          subject: targetCourse.title,
          subjectCode: targetCourse.code,
          semesterNo: targetCourse.semesterNo,
          unitNumber: finalUnitNum,
          chapterTitle: mappedUnit.unitTitle || finalChapterTitle,
          teachingHours: mappedUnit.teachingHours || (targetUnit ? targetUnit.teachingHours : null),
          scopeStatus: resolved.scopeStatus,
          enrolledSemesterCourses: resolved.enrolledSemesterCourses,
          totalSteps: orderedPlan.length,
          plan: orderedPlan,
          summary: {
            totalSteps: orderedPlan.length,
            syllabusTopicsCount: syllabusCount,
            noteExclusiveCount,
            pyqAlertsCount,
            totalPyqsMatched: mappedUnit.pyqQuestionsCount || 0,
            coverageRatio: mappedUnit.coverageRatio || 0,
            sourceFiles: Array.from(sourceFilesMap.values())
          }
        };
      }
    } catch (_) {}
  }

  const officialSubtopics = (targetUnit ? [...targetUnit.topics] : [])
    .map(cleanSyllabusTopic)
    .filter(Boolean);

  let teacherNoteSections = [];
  const seenNoteHeadings = new Set();
  const sourceFiles = new Map();

  if (db && typeof db.all === 'function') {
    try {
      await ensureRagSchema(db);

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

      const chunkQueryParams = [...fileQueryParams, `%${finalUnitNum}%`, `%${finalChapterTitle}%`];
      const chunkSql = `
        SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end,
               c.section_heading, c.heading_path, c.clean_content, c.topics_json,
               f.*, f.title as file_title, f.originalName as original_name
        FROM document_chunks c
        JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
        WHERE ${fileFilterSql}
          AND (c.unit LIKE ? OR c.chapter LIKE ? OR c.section_heading LIKE ? OR c.clean_content LIKE ?)
        ORDER BY c.file_id, c.page_start ASC, c.chunk_index ASC
      `;
      chunkQueryParams.push(`%${finalChapterTitle}%`, `%${finalChapterTitle}%`);

      const { canReadResource } = require('./kyana-access');
      const authCtx = academicContext
        ? (academicContext.authenticated !== undefined ? academicContext : { ...academicContext, authenticated: true })
        : null;
      const isChunkAuthorized = (ch) => {
        if (!ch || ch.deleted_at || ch.hidden_at || ['removed', 'hidden'].includes(ch.moderation_status)) return false;
        if (authCtx && typeof canReadResource === 'function') {
          return canReadResource(authCtx, ch, 'note', { allowCrossSemester: true });
        }
        return true;
      };

      const rawChunks = await db.all(chunkSql, ...chunkQueryParams);
      const chunks = (rawChunks || []).filter(isChunkAuthorized);

      for (const ch of chunks || []) {
        const fId = String(ch.file_id || ch.fileId);
        if (!sourceFiles.has(fId)) {
          sourceFiles.set(fId, {
            fileId: fId,
            title: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName || `Teacher Note #${fId}`,
            pageStart: ch.page_start ?? ch.pageStart ?? 1,
            pageEnd: ch.page_end ?? ch.pageEnd ?? 1
          });
        }

        const heading = (ch.section_heading || ch.sectionHeading || '').trim();
        const normHead = normalizeText(heading);
        if (!isGenericNoteHeading(heading) && normHead && !seenNoteHeadings.has(normHead)) {
          seenNoteHeadings.add(normHead);
          teacherNoteSections.push({
            heading,
            normalizedHeading: normHead,
            fileId: fId,
            fileTitle: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName,
            chunkId: ch.id,
            pageStart: ch.page_start ?? ch.pageStart ?? 1,
            pageEnd: ch.page_end ?? ch.pageEnd ?? 1,
            topics: safeJsonParse(ch.topics_json || ch.topicsJson, []),
            snippet: (ch.clean_content || ch.cleanContent || '').slice(0, 300)
          });
        }
      }

      if (teacherNoteSections.length === 0) {
        const rawFallbackChunks = await db.all(
          `SELECT c.id, c.file_id, c.chunk_index, c.page_start, c.page_end,
                  c.section_heading, c.heading_path, c.clean_content, c.topics_json,
                  f.*, f.title as file_title, f.originalName as original_name
           FROM document_chunks c
           JOIN files f ON ${db.isPostgres ? 'CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT)' : '(CAST(f.id AS TEXT) = CAST(c.file_id AS TEXT) OR f.id = CAST(c.file_id AS INTEGER))'}
           WHERE ${fileFilterSql}
           ORDER BY c.file_id, c.page_start ASC, c.chunk_index ASC
           LIMIT 25`,
          ...fileQueryParams
        );
        const fallbackChunks = (rawFallbackChunks || []).filter(isChunkAuthorized);

        for (const ch of fallbackChunks || []) {
          const fId = String(ch.file_id || ch.fileId);
          if (!sourceFiles.has(fId)) {
            sourceFiles.set(fId, {
              fileId: fId,
              title: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName || `Teacher Note #${fId}`,
              pageStart: ch.page_start ?? ch.pageStart ?? 1,
              pageEnd: ch.page_end ?? ch.pageEnd ?? 1
            });
          }
          const heading = (ch.section_heading || ch.sectionHeading || '').trim();
          const normHead = normalizeText(heading);
          if (!isGenericNoteHeading(heading) && normHead && !seenNoteHeadings.has(normHead)) {
            seenNoteHeadings.add(normHead);
            teacherNoteSections.push({
              heading,
              normalizedHeading: normHead,
              fileId: fId,
              fileTitle: ch.file_title || ch.fileTitle || ch.original_name || ch.originalName,
              chunkId: ch.id,
              pageStart: ch.page_start ?? ch.pageStart ?? 1,
              pageEnd: ch.page_end ?? ch.pageEnd ?? 1,
              topics: safeJsonParse(ch.topics_json || ch.topicsJson, []),
              snippet: (ch.clean_content || ch.cleanContent || '').slice(0, 300)
            });
          }
        }
      }
    } catch (_) {}
  }

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

  const reconciledSteps = [];
  const matchedNoteHeadingIndices = new Set();

  for (let sIdx = 0; sIdx < officialSubtopics.length; sIdx++) {
    const sylTopic = officialSubtopics[sIdx];
    const normSyl = normalizeText(sylTopic);

    const matchingNotes = [];
    for (let nIdx = 0; nIdx < teacherNoteSections.length; nIdx++) {
      const noteSec = teacherNoteSections[nIdx];
      const matchScore = computeTopicSimilarity(normSyl, noteSec.normalizedHeading, noteSec.topics);
      if (matchScore >= 0.5) {
        matchingNotes.push(noteSec);
        matchedNoteHeadingIndices.add(nIdx);
      }
    }

    const matchedPyqs = pyqList.filter((q) => {
      const qNorm = normalizeText(q.clean_question_text || q.cleanQuestionText || q.question_text || q.questionText || '');
      const topicNorm = normalizeText(q.primary_topic || q.primaryTopic || '');
      if (qNorm.includes(normSyl) || topicNorm === normSyl) return true;
      const sim = computeTopicSimilarity(normSyl, qNorm);
      if (sim >= 0.5) return true;
      const sylWords = normSyl.split(/\s+/).filter((w) => w.length >= 4 && !/^(?:list|lists)$/.test(w));
      if (sylWords.length >= 2 && sylWords.every((w) => qNorm.includes(w.replace(/s$/, '')) || qNorm.includes(w.replace(/ing$/, '')) || qNorm.includes(w.replace(/tion$/, '')))) return true;
      return false;
    });

    const stepSourceOrigin = matchingNotes.length > 0 ? 'syllabus_and_note' : 'syllabus_only';
    reconciledSteps.push({
      topicTitle: sylTopic,
      normalizedTopic: normSyl,
      originType: 'official_syllabus',
      sourceOrigin: stepSourceOrigin,
      coverageStatus: matchingNotes.length > 0 ? 'NOTES_COVERED' : 'MISSING_NOTES',
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

    for (let nIdx = 0; nIdx < teacherNoteSections.length; nIdx++) {
      if (!matchedNoteHeadingIndices.has(nIdx)) {
        const unmatch = teacherNoteSections[nIdx];
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
            originType: 'teaching_subtopic',
            sourceOrigin: 'note_exclusive',
            coverageStatus: 'NOTES_COVERED',
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
        originType: 'teaching_subtopic',
        sourceOrigin: 'note_exclusive',
        coverageStatus: 'NOTES_COVERED',
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
    scopeStatus: resolved.scopeStatus,
    enrolledSemesterCourses: resolved.enrolledSemesterCourses,
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

function computeTopicSimilarity(normSyllabus, normHeading, noteTopics = []) {
  if (!normSyllabus || !normHeading) return 0;
  if (normSyllabus === normHeading) return 1.0;

  const operations = ['insert', 'insertion', 'delete', 'deletion', 'reverse', 'reversing', 'search', 'searching', 'traverse', 'traversal', 'sort', 'sorting', 'malloc'];
  const sylOps = operations.filter((op) => normSyllabus.includes(op));
  const headOps = operations.filter((op) => normHeading.includes(op));

  if (headOps.includes('malloc') && !sylOps.includes('malloc')) {
    return 0.35;
  }

  if (sylOps.length > 0 && headOps.length > 0 && !sylOps.some((o) => headOps.includes(o))) {
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

  for (const c of CONCEPT_TAXONOMY) {
    const hasSyl = c.aliases.some((a) => normSyllabus === a || (a.length >= 6 && normSyllabus.includes(a)));
    const hasHead = c.aliases.some((a) => normHeading === a || (a.length >= 6 && normHeading.includes(a)));
    if (hasSyl && hasHead) return 0.9;
  }

  if (headOps.length === 0 && overlap > 0 && (dice >= 0.33 || (sylTokens.size > 0 && overlap / sylTokens.size >= 0.45))) {
    return Number((0.42 + Math.min(0.27, dice * 0.45)).toFixed(3));
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
  getStudentEnrolledCourses,
  findCourseAndUnitByTopicQuery,
  resolveCourseAndChapter,
  buildReconciledStudyPlan,
  computeTopicSimilarity
};
