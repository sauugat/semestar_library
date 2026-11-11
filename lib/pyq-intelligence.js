'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const {
  normalizeText,
  parseSemesterNumber,
  loadSyllabusRegistry,
  CONCEPT_TAXONOMY
} = require('./academic-document-understanding');

/**
 * Extracts individual past exam questions from raw text.
 * Works with typical Gandaki University and university board question papers:
 * - Group / Section headers (e.g. "Group A - Short Questions", "Group B - Long Questions")
 * - Numbered questions (e.g. "1. Define ... [5]", "Q. 2 (a) Explain ...", "3 a) Write a C program ...")
 * - Marks notation (e.g. "[5]", "(10)", "[2+3=5]", "5 marks")
 */
function parsePyqDocumentToQuestions(rawText, options = {}) {
  const text = String(rawText || '').replace(/\r/g, '');
  if (!text.trim()) return [];

  const defaultSubject = options.subject || null;
  const defaultSubjectCode = options.subjectCode || null;
  const defaultSemesterNo = parseSemesterNumber(options.semesterNo || options.semester);
  const defaultExamYear = options.examYear || extractExamYear(text) || '2080 BS';
  const defaultExamType = options.examType || extractExamType(text) || 'Final Exam';

  const lines = text.split('\n');
  const questions = [];

  let currentSection = null;
  let currentQNum = null;
  let currentBuffer = [];
  let currentMarks = null;

  const flushQuestion = () => {
    if (!currentQNum || currentBuffer.length === 0) return;
    const fullQText = currentBuffer.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullQText || fullQText.length < 5) return;

    const detectedMarks = currentMarks !== null ? currentMarks : extractMarksFromText(fullQText) || 5;
    const cleanText = cleanQuestionText(fullQText);
    const category = categorizeQuestion(cleanText);
    const extractedTopic = extractCandidateTopic(cleanText);

    questions.push({
      questionNumber: currentQNum,
      sectionLabel: currentSection,
      questionText: fullQText,
      cleanQuestionText: cleanText,
      marks: detectedMarks,
      questionCategory: category,
      primaryTopic: extractedTopic.topic,
      normalizedTopic: extractedTopic.normalizedTopic,
      unitNumber: options.unitNumber || null,
      chapterTitle: options.chapterTitle || null,
      subject: defaultSubject,
      subjectCode: defaultSubjectCode,
      semesterNo: defaultSemesterNo,
      examYear: defaultExamYear,
      examType: defaultExamType
    });

    currentBuffer = [];
    currentMarks = null;
  };

  const sectionRegex = /^(?:group\s+[a-z]|section\s+[a-z]|part\s+[a-z]|long\s+questions?|short\s+questions?|very\s+short\s+questions?|brief\s+questions?)/i;
  // Matches question starts:
  // "1.", "Q.1", "Q1", "1 (a)", "1.a)", "1(a)", "Question 1:"
  const qStartRegex = /^(?:q(?:uestion)?\.?\s*(\d{1,2}(?:\s*\(?[a-d]\)?)?)|\b(\d{1,2})\s*[\.\):-]\s*(?:\(([a-d])\))?|\b(\d{1,2}\s*\([a-d]\)))\s*(.*)$/i;
  // Sub-question on a separate line: "(a) What is ...", "a) What is ..."
  const subQRegex = /^(?:\(([a-d])\)|([a-d])\))\s+(.*)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect Section / Group
    if (sectionRegex.test(line) && line.length < 60) {
      flushQuestion();
      currentSection = line;
      continue;
    }

    // Skip university header lines
    if (isUniversityHeaderLine(line)) {
      continue;
    }

    // Check Question Start
    const qMatch = line.match(qStartRegex);
    if (qMatch) {
      flushQuestion();
      const numPart = (qMatch[1] || qMatch[2] || qMatch[4] || '').replace(/\s+/g, '');
      const subPart = qMatch[3] ? `(${qMatch[3]})` : '';
      currentQNum = `${numPart}${subPart}`.trim();
      const remainder = qMatch[5] || '';
      if (remainder) {
        currentBuffer.push(remainder);
        const m = extractMarksFromText(remainder);
        if (m !== null) currentMarks = m;
      }
      continue;
    }

    // Check sub-question
    const subMatch = line.match(subQRegex);
    if (subMatch && currentQNum) {
      const bufferText = currentBuffer.join(' ').trim();
      const isStemIntro = bufferText.endsWith(':') || /(?:following|algorithms? for|explain both|write notes? on):?$/i.test(bufferText);
      const subHasMarks = extractMarksFromText(line) !== null;

      // If preceding buffer was an intro stem ending with ':', keep sub-bullets in the main question
      if (isStemIntro || (currentBuffer.some(b => b.trim().endsWith(':')) && !currentBuffer.some(b => extractMarksFromText(b) !== null))) {
        currentBuffer.push(line);
        const m = extractMarksFromText(line);
        if (m !== null) currentMarks = m;
        continue;
      }

      // If we already have content in current buffer, flush parent and make sub-question
      if (currentBuffer.length > 0) {
        flushQuestion();
      }
      const subLetter = subMatch[1] || subMatch[2];
      const baseNum = currentQNum.replace(/\([a-z]\)/i, '');
      currentQNum = `${baseNum}(${subLetter})`;
      currentBuffer.push(subMatch[3]);
      const m = extractMarksFromText(subMatch[3]);
      if (m !== null) currentMarks = m;
      continue;
    }

    // Continuation line
    if (currentQNum) {
      currentBuffer.push(line);
      const m = extractMarksFromText(line);
      if (m !== null) currentMarks = m;
    }
  }

  flushQuestion();

  // If regex segmentation returned 0 questions (e.g. non-standard format), fall back to paragraph split
  if (questions.length === 0 && text.trim().length > 20) {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 20);
    paragraphs.forEach((para, idx) => {
      const detectedMarks = extractMarksFromText(para) || 5;
      const cleanText = cleanQuestionText(para);
      const extractedTopic = extractCandidateTopic(cleanText);
      questions.push({
        questionNumber: String(idx + 1),
        sectionLabel: null,
        questionText: para,
        cleanQuestionText: cleanText,
        marks: detectedMarks,
        questionCategory: categorizeQuestion(cleanText),
        primaryTopic: extractedTopic.topic,
        normalizedTopic: extractedTopic.normalizedTopic,
        unitNumber: options.unitNumber || null,
        chapterTitle: options.chapterTitle || null,
        subject: defaultSubject,
        subjectCode: defaultSubjectCode,
        semesterNo: defaultSemesterNo,
        examYear: defaultExamYear,
        examType: defaultExamType
      });
    });
  }

  return questions;
}

function isUniversityHeaderLine(line) {
  const norm = line.toLowerCase();
  return (
    norm.includes('gandaki university') ||
    norm.includes('bachelor of information technology') ||
    norm.includes('time:') ||
    norm.includes('full marks:') ||
    norm.includes('pass marks:') ||
    norm.includes('candidates are required to give') ||
    norm.includes('attempt all questions') ||
    norm.includes('attempt any') ||
    norm.includes('figures in the margin indicate')
  );
}

function extractExamYear(text) {
  const m = text.match(/\b(20[789]\d(?:\s*BS)?|202[0-9](?:\s*AD)?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractExamType(text) {
  const norm = text.toLowerCase();
  if (norm.includes('pre-board') || norm.includes('pre board')) return 'Pre-Board Exam';
  if (norm.includes('mid-term') || norm.includes('mid term') || norm.includes('midterm')) return 'Mid-Term Exam';
  if (norm.includes('terminal')) return 'Terminal Exam';
  if (norm.includes('final') || norm.includes('board examination') || norm.includes('end semester')) return 'Final Exam';
  return 'Final Exam';
}

function extractMarksFromText(text) {
  // Matches "[5]", "(10)", "[2+3=5]", "[2.5+2.5=5]", "[10 Marks]", "(5 marks)"
  const m = text.match(/(?:\[|\()(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)(?:\s*=\s*(\d+(?:\.\d+)?))?(?:\s*marks?)?(?:\]|\))/i);
  if (!m) return null;
  if (m[2]) return Math.round(Number(m[2]));
  const sumParts = m[1].split('+').map((s) => Number(s.trim()));
  const total = sumParts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return Math.round(total) || 5;
}

function cleanQuestionText(raw) {
  return raw
    .replace(/(?:\[|\()\s*\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*(?:\s*=\s*\d+)?(?:\s*marks?)?\s*(?:\]|\))/gi, '')
    .replace(/^q(?:uestion)?\.?\s*\d+(?:\s*\([a-z]\))?[\s.:-]*/i, '')
    .replace(/^\d+[\s.):-]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function categorizeQuestion(text) {
  const norm = text.toLowerCase();
  if (
    norm.includes('write a program') ||
    norm.includes('write a c') ||
    norm.includes('write a java') ||
    norm.includes('write code') ||
    norm.includes('write an algorithm') ||
    norm.includes('implement a function') ||
    norm.includes('write syntax') ||
    norm.includes('pseudo-code') ||
    norm.includes('pseudocode')
  ) {
    return 'code';
  }
  if (
    norm.includes('differentiate') ||
    norm.includes('difference between') ||
    norm.includes('compare and contrast') ||
    norm.includes('compare ') ||
    norm.includes(' vs ') ||
    norm.includes('versus')
  ) {
    return 'comparison';
  }
  if (
    norm.includes('calculate') ||
    norm.includes('compute') ||
    norm.includes('solve the following') ||
    norm.includes('find the value') ||
    norm.includes('find the output') ||
    norm.includes('evaluate') ||
    norm.includes('dry run')
  ) {
    return 'numerical';
  }
  if (
    norm.includes('derive') ||
    norm.includes('prove that') ||
    norm.includes('show that') ||
    norm.includes('mathematical induction')
  ) {
    return 'derivation';
  }
  return 'theory';
}

function extractCandidateTopic(cleanText) {
  const norm = normalizeText(cleanText);

  // Check CONCEPT_TAXONOMY first
  for (const c of CONCEPT_TAXONOMY) {
    for (const alias of [c.canonical.toLowerCase(), ...c.aliases]) {
      if (norm.includes(alias)) {
        return { topic: c.canonical, normalizedTopic: normalizeText(c.canonical) };
      }
    }
  }

  // Common technical patterns e.g. "What is [Topic]?", "Explain [Topic] with example", "Define [Topic]"
  const patternMatch = cleanText.match(/(?:what is|define|explain|describe|illustrate|discuss|write notes? on|short note on|working of|architecture of)\s+([A-Za-z0-9\s/()-]{3,50}?)(?:\?|\.|,|with|in|using|for|and|$)/i);
  if (patternMatch && patternMatch[1]) {
    const rawTopic = patternMatch[1].trim();
    if (rawTopic.length >= 3 && !/^(?:the|a|an|it|this|that|following)$/i.test(rawTopic)) {
      return { topic: rawTopic, normalizedTopic: normalizeText(rawTopic) };
    }
  }

  // Fallback to first 4 meaningful words
  const words = cleanText.split(/\s+/).filter((w) => w.length > 2 && !/^(?:what|how|why|when|where|which|explain|define|describe|write|give|with|state)$/i.test(w));
  const fallbackTopic = words.slice(0, 4).join(' ');
  return { topic: fallbackTopic || 'General Topic', normalizedTopic: normalizeText(fallbackTopic || 'general') };
}

/**
 * Links a PYQ question to official syllabus units and teacher note chunks.
 */
async function linkPyqQuestionToCurriculum(db, question, options = {}) {
  const registry = loadSyllabusRegistry();
  const rawSubject = question.subject || options.subject || null;
  const semNo = parseSemesterNumber(question.semester_no || options.semesterNo);
  const qClean = question.cleanQuestionText || question.questionText || '';
  const normQ = normalizeText(qClean);

  let matchedCourse = null;
  if (rawSubject) {
    const normSub = normalizeText(rawSubject);
    matchedCourse = registry.courses.find((c) =>
      c.normalizedTitle === normSub ||
      normalizeText(c.code) === normSub ||
      c.normalizedTitle.includes(normSub)
    );
  }

  // If subject was not provided or not matched, check candidate courses
  if (!matchedCourse && semNo) {
    matchedCourse = registry.courses.find((c) => c.semesterNo === semNo && containsConceptTerm(normQ, c.normalizedTitle));
  }

  let bestUnitNumber = question.unit_number || options.unitNumber || null;
  let bestChapterTitle = question.chapter_title || options.chapterTitle || null;
  let bestTopic = question.primary_topic || null;
  let bestNormTopic = question.normalized_topic || null;
  let bestScore = 0;

  if (matchedCourse) {
    for (const u of matchedCourse.units || []) {
      const uTitleNorm = normalizeText(u.title);
      const uTitleMatch = normQ.includes(uTitleNorm) || (uTitleNorm.length >= 4 && uTitleNorm.split(/\s+/).every(w => normQ.includes(w.replace(/s$/, ''))));
      const unitBonus = uTitleMatch ? 15 : 0;

      for (const t of u.topics || []) {
        const normT = normalizeText(t);
        if (normT.length < 3) continue;

        let score = 0;
        if (normQ.includes(normT)) {
          score = normT.length * 2 + unitBonus;
        } else {
          const tTokens = normT.split(/\s+/).filter(w => w.length >= 3);
          let tokenHits = 0;
          for (const tok of tTokens) {
            const stem = tok.replace(/s$/, '').replace(/ing$/, '').replace(/tion$/, '');
            if (normQ.includes(stem)) tokenHits++;
          }
          if (tTokens.length > 0 && tokenHits >= 2 && tokenHits / tTokens.length >= 0.5) {
            score = tokenHits * 8 + unitBonus;
          } else if (unitBonus > 0 && tokenHits >= 1) {
            score = tokenHits * 6 + unitBonus;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestUnitNumber = u.unitNumber;
          bestChapterTitle = u.title;
          bestTopic = t;
          bestNormTopic = normT;
        }
      }
    }
  }

  // Find matching teacher note chunk in `document_chunks` if db is available
  let noteFileId = null;
  let noteChunkId = null;
  let notePageNumber = null;
  let relevanceScore = bestScore > 0 ? 0.88 : 0.75;

  if (db && typeof db.all === 'function' && (bestNormTopic || normQ)) {
    try {
      await ensureRagSchema(db);
      const cleanSearch = (bestNormTopic || normQ.slice(0, 40)).replace(/lists\b/gi, 'list');
      const chunkParams = [`%${cleanSearch}%`, `%${cleanSearch}%`];
      let sql = `SELECT id, file_id, page_start, section_heading, unit, chapter
                 FROM document_chunks
                 WHERE (clean_content LIKE ? OR section_heading LIKE ?)`;
      if (rawSubject) {
        sql += ` AND (subject LIKE ? OR subject_code LIKE ?)`;
        chunkParams.push(`%${rawSubject}%`, `%${rawSubject}%`);
      }
      sql += ` LIMIT 1`;

      let chunkRows = await db.all(sql, ...chunkParams);
      if ((!chunkRows || chunkRows.length === 0) && bestNormTopic) {
        const words = bestNormTopic.split(/\s+/).filter(w => w.length >= 4).map(w => w.replace(/s$/, ''));
        if (words.length >= 2) {
          const fallbackParams = words.slice(0, 2).map(w => `%${w}%`);
          let fbSql = `SELECT id, file_id, page_start, section_heading, unit, chapter
                       FROM document_chunks
                       WHERE (clean_content LIKE ? AND clean_content LIKE ?)`;
          if (rawSubject) {
            fbSql += ` AND (subject LIKE ? OR subject_code LIKE ?)`;
            fallbackParams.push(`%${rawSubject}%`, `%${rawSubject}%`);
          }
          fbSql += ` LIMIT 1`;
          chunkRows = await db.all(fbSql, ...fallbackParams);
        }
      }

      if (chunkRows && chunkRows.length > 0) {
        const matched = chunkRows[0];
        noteChunkId = matched.id;
        noteFileId = String(matched.file_id || matched.fileId || '');
        notePageNumber = matched.page_start || matched.pageStart || 1;
        relevanceScore = 0.95;
      }
    } catch (_) {}
  }

  return {
    subject: matchedCourse ? matchedCourse.title : (rawSubject || 'General'),
    subjectCode: matchedCourse ? matchedCourse.code : (question.subject_code || null),
    semesterNo: matchedCourse ? matchedCourse.semesterNo : semNo,
    unitNumber: bestUnitNumber,
    chapterTitle: bestChapterTitle,
    primaryTopic: bestTopic || 'General Concept',
    normalizedTopic: bestNormTopic || normalizeText(bestTopic || 'general concept'),
    noteFileId,
    noteChunkId,
    notePageNumber,
    relevanceScore
  };
}

/**
 * Ingests an entire past paper document into `pyq_papers`, `pyq_questions`, and `pyq_topic_links`.
 */
async function ingestPyqPaper(db, payload) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();

  const paperId = payload.paperId || 'pyq_paper_' + crypto.randomUUID().slice(0, 16);
  const fileId = payload.fileId ? Number(payload.fileId) : null;
  const subject = payload.subject || 'General Academic';
  const subjectCode = payload.subjectCode || null;
  const semesterNo = parseSemesterNumber(payload.semesterNo || payload.semester) || 1;
  const examYear = payload.examYear || extractExamYear(payload.rawText || '') || '2080 BS';
  const examType = payload.examType || extractExamType(payload.rawText || '') || 'Final Exam';
  const university = payload.university || 'Gandaki University';
  const title = payload.title || `${subject} (${examYear} ${examType})`;
  const uploadedBy = payload.uploadedBy || null;

  const parsedQuestions = parsePyqDocumentToQuestions(payload.rawText || '', {
    subject,
    subjectCode,
    semesterNo,
    examYear,
    examType,
    unitNumber: payload.unitNumber,
    chapterTitle: payload.chapterTitle
  });

  await db.run(
    `INSERT INTO pyq_papers (
      id, file_id, subject, subject_code, semester_no,
      exam_year, exam_type, university, title, total_marks,
      pass_marks, questions_count, extraction_status, uploaded_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    paperId,
    fileId,
    subject,
    subjectCode,
    semesterNo,
    examYear,
    examType,
    university,
    title,
    payload.totalMarks || 100,
    payload.passMarks || 40,
    parsedQuestions.length,
    'INDEXED',
    uploadedBy,
    now,
    now
  );

  const savedQuestions = [];

  for (let i = 0; i < parsedQuestions.length; i++) {
    const q = parsedQuestions[i];
    const qId = `pyq_q_${paperId}_${i + 1}`;

    const linked = await linkPyqQuestionToCurriculum(db, q, {
      subject,
      subjectCode,
      semesterNo
    });

    await db.run(
      `INSERT INTO pyq_questions (
        id, paper_id, file_id, subject, subject_code, semester_no,
        exam_year, exam_type, section_label, question_number,
        question_text, clean_question_text, marks, unit_number,
        chapter_title, primary_topic, normalized_topic, difficulty,
        question_category, model_answer_hint, page_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      qId,
      paperId,
      fileId,
      linked.subject,
      linked.subjectCode,
      linked.semesterNo,
      examYear,
      examType,
      q.sectionLabel || null,
      q.questionNumber,
      q.questionText,
      q.cleanQuestionText,
      q.marks,
      linked.unitNumber,
      linked.chapterTitle,
      linked.primaryTopic,
      linked.normalizedTopic,
      q.marks >= 10 ? 'hard' : (q.marks >= 5 ? 'medium' : 'easy'),
      q.questionCategory,
      q.modelAnswerHint || null,
      q.pageNumber || 1,
      now
    );

    // Save link in `pyq_topic_links`
    const linkId = `pyq_link_${qId}`;
    await db.run(
      `INSERT INTO pyq_topic_links (
        id, question_id, subject, subject_code, semester_no,
        unit_number, topic, normalized_topic, note_file_id,
        note_chunk_id, note_page_number, relevance_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      linkId,
      qId,
      linked.subject,
      linked.subjectCode,
      linked.semesterNo,
      linked.unitNumber,
      linked.primaryTopic,
      linked.normalizedTopic,
      linked.noteFileId,
      linked.noteChunkId,
      linked.notePageNumber,
      linked.relevanceScore,
      now
    );

    savedQuestions.push({
      id: qId,
      ...q,
      ...linked
    });
  }

  return {
    paperId,
    title,
    subject,
    subjectCode,
    semesterNo,
    examYear,
    examType,
    questionsCount: savedQuestions.length,
    questions: savedQuestions
  };
}

/**
 * Searches past exam questions with curriculum and note linking.
 */
async function searchPyqQuestions(db, filters = {}) {
  await ensureRagSchema(db);

  const whereClauses = [];
  const params = [];

  if (filters.subject) {
    whereClauses.push(`(q.subject LIKE ? OR q.subject_code LIKE ?)`);
    params.push(`%${filters.subject}%`, `%${filters.subject}%`);
  }

  if (filters.subjectCode) {
    whereClauses.push(`q.subject_code = ?`);
    params.push(filters.subjectCode);
  }

  if (filters.semesterNo !== undefined && filters.semesterNo !== null) {
    whereClauses.push(`q.semester_no = ?`);
    params.push(Number(filters.semesterNo));
  }

  if (filters.unitNumber !== undefined && filters.unitNumber !== null) {
    whereClauses.push(`q.unit_number = ?`);
    params.push(Number(filters.unitNumber));
  }

  if (filters.normalizedTopic) {
    whereClauses.push(`(q.normalized_topic LIKE ? OR q.clean_question_text LIKE ?)`);
    params.push(`%${filters.normalizedTopic}%`, `%${filters.normalizedTopic}%`);
  }

  if (filters.examYear) {
    whereClauses.push(`q.exam_year = ?`);
    params.push(filters.examYear);
  }

  if (filters.query) {
    const qNorm = normalizeText(filters.query);
    whereClauses.push(`(q.clean_question_text LIKE ? OR q.primary_topic LIKE ? OR q.chapter_title LIKE ?)`);
    params.push(`%${qNorm}%`, `%${qNorm}%`, `%${qNorm}%`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limit = Math.min(50, Math.max(1, Number(filters.limit) || 15));
  const offset = Math.max(0, Number(filters.offset) || 0);

  const querySql = `
    SELECT
      q.id, q.paper_id, q.file_id, q.subject, q.subject_code, q.semester_no,
      q.exam_year, q.exam_type, q.section_label, q.question_number,
      q.question_text, q.clean_question_text, q.marks, q.unit_number,
      q.chapter_title, q.primary_topic, q.normalized_topic, q.difficulty,
      q.question_category, q.model_answer_hint, q.page_number,
      l.note_file_id, l.note_chunk_id, l.note_page_number, l.relevance_score
    FROM pyq_questions q
    LEFT JOIN pyq_topic_links l ON l.question_id = q.id
    ${whereSql}
    ORDER BY q.exam_year DESC, q.unit_number ASC, q.marks DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const rows = await db.all(querySql, ...params);
  return rows || [];
}

/**
 * Returns past question frequency and exam repetition analytics for a topic or unit.
 */
async function getTopicPyqAnalytics(db, { subject, semesterNo, unitNumber, normalizedTopic }) {
  await ensureRagSchema(db);

  const questions = await searchPyqQuestions(db, {
    subject,
    semesterNo,
    unitNumber,
    normalizedTopic,
    limit: 50
  });

  const yearMap = new Map();
  const examTypeCounts = {};
  let totalMarks = 0;

  for (const q of questions) {
    const yr = q.exam_year || q.examYear;
    if (yr) {
      if (!yearMap.has(yr)) yearMap.set(yr, []);
      yearMap.get(yr).push(q);
    }
    const t = q.exam_type || q.examType || 'Final Exam';
    examTypeCounts[t] = (examTypeCounts[t] || 0) + 1;
    totalMarks += Number(q.marks) || 5;
  }

  const distinctYears = Array.from(yearMap.keys()).sort().reverse();
  const timesAsked = questions.length;

  return {
    timesAsked,
    distinctYearsCount: distinctYears.length,
    examYears: distinctYears,
    examTypes: examTypeCounts,
    averageMarks: timesAsked > 0 ? Number((totalMarks / timesAsked).toFixed(1)) : 0,
    totalMarksWeight: totalMarks,
    topQuestions: questions.slice(0, 5)
  };
}

module.exports = {
  parsePyqDocumentToQuestions,
  linkPyqQuestionToCurriculum,
  ingestPyqPaper,
  searchPyqQuestions,
  getTopicPyqAnalytics,
  extractMarksFromText,
  categorizeQuestion,
  extractCandidateTopic
};
