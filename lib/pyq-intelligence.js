'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const {
  normalizeText,
  parseSemesterNumber,
  loadSyllabusRegistry,
  CONCEPT_TAXONOMY
} = require('./academic-document-understanding');
const {
  getActiveEmbeddingModelInfo,
  generateEmbeddingsBatch,
  computeLocalAcademicEmbedding,
  cosineSimilarity
} = require('./semantic-chunker');
const { canReadResource } = require('./kyana-access');

// Semantic descriptors for BIT syllabus topics so paraphrased exam questions
// align with official syllabus topic representations both in neural and local hybrid vector spaces.
const SYLLABUS_SEMANTIC_DESCRIPTORS = [
  {
    topicPatterns: ['mathematical induction', 'logic and induction', 'induction'],
    keywords: [
      'mathematical induction', 'base case', 'base step', 'inductive hypothesis',
      'inductive step', 'prove for all positive integers', 'natural numbers',
      'n=1', 'n=k', 'n=k+1', 'strong induction', 'weak induction', 'well ordering'
    ]
  },
  {
    topicPatterns: ['proposition', 'propositional logic', 'tautology', 'logical equivalence', 'predicate', 'quantifiers'],
    keywords: [
      'compound proposition', 'truth table', 'tautology', 'contradiction', 'contingency',
      'logical equivalence', 'de morgan laws', 'contrapositive', 'converse', 'inverse',
      'implication', 'biconditional', 'universal quantifier', 'existential quantifier',
      'rules of inference', 'modus ponens', 'modus tollens', 'valid argument'
    ]
  },
  {
    topicPatterns: ['stack', 'stacks', 'queue', 'queues'],
    keywords: [
      'lifo', 'last in first out', 'push', 'pop', 'stack overflow', 'stack underflow',
      'infix to postfix', 'prefix', 'postfix evaluation', 'fifo', 'first in first out',
      'enqueue', 'dequeue', 'circular queue', 'priority queue', 'deque'
    ]
  },
  {
    topicPatterns: ['recursion', 'recursive'],
    keywords: [
      'recursion', 'recursive function', 'self calling function', 'base condition',
      'terminating condition', 'call stack', 'activation frame', 'activation record',
      'tail recursion', 'tower of hanoi', 'factorial', 'fibonacci'
    ]
  },
  {
    topicPatterns: ['tree', 'trees', 'binary tree', 'binary search tree', 'bst', 'avl'],
    keywords: [
      'binary tree', 'binary search tree', 'bst', 'left subtree', 'right subtree',
      'root node', 'leaf node', 'inorder', 'preorder', 'postorder', 'tree traversal',
      'avl tree', 'balance factor', 'tree rotation', 'heap', 'b-tree'
    ]
  },
  {
    topicPatterns: ['sorting', 'searching', 'asymptotic', 'complexity'],
    keywords: [
      'quicksort', 'mergesort', 'bubble sort', 'insertion sort', 'selection sort',
      'heap sort', 'binary search', 'linear search', 'divide and conquer',
      'time complexity', 'space complexity', 'big o', 'big omega', 'big theta', 'asymptotic notation'
    ]
  },
  {
    topicPatterns: ['hashing', 'hash table', 'collision'],
    keywords: [
      'hash function', 'hash table', 'collision resolution', 'linear probing',
      'quadratic probing', 'double hashing', 'separate chaining', 'open addressing', 'load factor'
    ]
  },
  {
    topicPatterns: ['graph', 'graphs', 'shortest path', 'spanning tree'],
    keywords: [
      'vertices', 'edges', 'adjacency matrix', 'adjacency list', 'bfs', 'dfs',
      'breadth first search', 'depth first search', 'dijkstra', 'kruskal', 'prim',
      'minimum spanning tree', 'shortest path', 'bipartite', 'euler', 'hamiltonian', 'planar graph', 'graph coloring'
    ]
  },
  {
    topicPatterns: ['cascading style sheet', 'css', 'style sheet', 'box model', 'selector', 'flexbox'],
    keywords: [
      'inline style', 'internal stylesheet', 'external stylesheet', 'css selector',
      'class selector', 'id selector', 'specificity', 'cascade', 'box model',
      'margin', 'border', 'padding', 'content area', 'flexbox', 'css grid', 'media query', 'responsive'
    ]
  },
  {
    topicPatterns: ['javascript', 'dom', 'document object model', 'event handling', 'form validation'],
    keywords: [
      'javascript', 'variables', 'let', 'const', 'var', 'lexical scope', 'closures',
      'functions', 'arrow function', 'dom manipulation', 'getelementbyid', 'queryselector',
      'event listener', 'event bubbling', 'form validation', 'regex', 'ajax', 'fetch', 'json'
    ]
  },
  {
    topicPatterns: ['normalization', 'normal form', 'functional dependency'],
    keywords: [
      'database normalization', 'data redundancy', 'insertion anomaly', 'update anomaly',
      'deletion anomaly', 'functional dependency', 'partial dependency', 'transitive dependency',
      '1nf', '2nf', '3nf', 'bcnf', 'first normal form', 'second normal form', 'third normal form',
      'boyce codd normal form', 'lossless join', 'dependency preserving'
    ]
  },
  {
    topicPatterns: ['er model', 'entity relationship', 'relational model', 'relational algebra', 'sql'],
    keywords: [
      'entity relationship diagram', 'er diagram', 'entity', 'attribute', 'cardinality',
      'weak entity', 'foreign key', 'primary key', 'candidate key', 'super key',
      'relational algebra', 'selection', 'projection', 'natural join', 'cartesian product',
      'er to relational mapping', 'tables and schemas'
    ]
  },
  {
    topicPatterns: ['transaction', 'concurrency', 'recovery', 'locking', 'acid'],
    keywords: [
      'acid properties', 'atomicity', 'consistency', 'isolation', 'durability',
      'serializability', 'conflict serializability', 'two phase locking', '2pl',
      'timestamp ordering', 'thomas write rule', 'deadlock', 'log based recovery', 'checkpoint'
    ]
  },
  {
    topicPatterns: ['deadlock', 'process synchronization', 'semaphore', 'mutex', 'scheduling'],
    keywords: [
      'mutual exclusion', 'hold and wait', 'no preemption', 'circular wait',
      'banker algorithm', 'safe state', 'resource allocation graph', 'critical section',
      'race condition', 'semaphore', 'mutex', 'cpu scheduling', 'fcfs', 'sjf', 'round robin', 'turnaround time', 'waiting time'
    ]
  },
  {
    topicPatterns: ['pointer', 'pointers', 'dynamic memory', 'structure', 'file handling'],
    keywords: [
      'pointer arithmetic', 'dereference', 'memory address', 'call by reference',
      'call by value', 'malloc', 'calloc', 'realloc', 'free', 'dynamic memory allocation',
      'struct', 'union', 'fopen', 'fclose', 'fread', 'fwrite'
    ]
  },
  {
    topicPatterns: ['inheritance', 'polymorphism', 'encapsulation', 'abstraction', 'class', 'object', 'jvm', 'jit'],
    keywords: [
      'object oriented programming', 'class and object', 'constructor', 'method overloading',
      'method overriding', 'single inheritance', 'multilevel inheritance', 'multiple inheritance',
      'abstract class', 'interface', 'dynamic binding', 'virtual function', 'bytecode',
      'java virtual machine', 'just in time compiler', 'dynamic compilation'
    ]
  }
];

// In-memory cache for syllabus topic embeddings keyed by `${courseKey}|${modelName}|${modelVersion}`
const syllabusTopicEmbeddingCache = new Map();

function clearSyllabusTopicEmbeddingCache() {
  syllabusTopicEmbeddingCache.clear();
}

/**
 * Normalizes a PYQ question while preserving mathematical notation, complexity expressions,
 * and technical symbols (`O(n log n)`, `n^2`, `1NF`, `2NF`, `3NF`, `BCNF`, `C++`, `TCP/IP`).
 */
function normalizeQuestionForSemanticMatching(rawQuestionText = '') {
  const s = String(rawQuestionText || '')
    .replace(/\r/g, ' ')
    .replace(/(?:\[|\()\s*\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*(?:\s*=\s*\d+)?(?:\s*marks?)?\s*(?:\]|\))/gi, ' ')
    .replace(/^q(?:uestion)?\.?\s*\d+(?:\s*\([a-z0-9]+\))?[\s.:-]*/i, ' ')
    .replace(/^\d+[\s.):-]+\s*/, ' ')
    .replace(/\b(?:define|explain|describe|illustrate|discuss|write\s+(?:short\s+)?notes?\s+on|differentiate\s+between|compare\s+and\s+contrast|state\s+and\s+prove|prove\s+that|show\s+that|what\s+is|what\s+are|how\s+does|with\s+(?:a\s+)?(?:suitable\s+|neat\s+)?(?:example|diagram)s?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || String(rawQuestionText || '').trim();
}

function computeContentFingerprint(text = '') {
  return crypto
    .createHash('sha1')
    .update(normalizeText(text))
    .digest('hex')
    .slice(0, 24);
}

function formatPageRangeLabel(pageNumber, pageEnd, provenanceStatus = 'verified') {
  if (provenanceStatus === 'unavailable' || !pageNumber) {
    return null;
  }
  const start = Number(pageNumber) || 1;
  const end = Number(pageEnd) || start;
  return end > start ? `Pages ${start}–${end}` : `Page ${start}`;
}

/**
 * Normalizes input into an array of page objects:
 * `[{ pageNumber, text, provenanceStatus }]`
 */
function normalizePyqInputToPages(rawInput, options = {}) {
  // 1. Explicit `options.pages` array or `rawInput` array of page objects
  const pagesArray = Array.isArray(options.pages) && options.pages.length > 0
    ? options.pages
    : (Array.isArray(rawInput) ? rawInput : null);

  if (pagesArray && pagesArray.length > 0) {
    const normalized = [];
    for (let idx = 0; idx < pagesArray.length; idx++) {
      const p = pagesArray[idx];
      if (typeof p === 'string') {
        normalized.push({
          pageNumber: idx + 1,
          text: p,
          provenanceStatus: 'verified'
        });
      } else if (p && typeof p === 'object') {
        const pNum = Number(p.page_number ?? p.pageNumber ?? (idx + 1)) || (idx + 1);
        const pText = String(p.cleaned_text ?? p.cleanedText ?? p.raw_text ?? p.rawText ?? p.text ?? '');
        normalized.push({
          pageNumber: pNum,
          text: pText,
          provenanceStatus: 'verified'
        });
      }
    }
    return normalized;
  }

  // 2. String input
  const rawText = typeof rawInput === 'string' ? rawInput : String(options.rawText || options.fullText || '');
  if (!rawText.trim()) return [];

  // Check if string contains form-feed `\f` page breaks (used by `extractPdfDocument`, `extractDocxDocument`, `extractTxtDocument`)
  if (rawText.includes('\f')) {
    const parts = rawText.split(/\f+/);
    return parts.map((part, idx) => ({
      pageNumber: idx + 1,
      text: part,
      provenanceStatus: 'verified'
    }));
  }

  // Check if string has explicit `--- Page X ---` or `[Page X]` markers
  const explicitPageMarkerRegex = /(?:^|\n)\s*(?:---\s*Page\s*(\d+)\s*---|\[Page\s*(\d+)\])\s*(?:\n|$)/gi;
  if (explicitPageMarkerRegex.test(rawText)) {
    const segments = [];
    let lastIndex = 0;
    let currentPageNo = 1;
    explicitPageMarkerRegex.lastIndex = 0;
    let m;
    while ((m = explicitPageMarkerRegex.exec(rawText)) !== null) {
      const chunk = rawText.slice(lastIndex, m.index);
      if (chunk.trim()) {
        segments.push({ pageNumber: currentPageNo, text: chunk, provenanceStatus: 'verified' });
      }
      currentPageNo = Number(m[1] || m[2]) || (currentPageNo + 1);
      lastIndex = m.index + m[0].length;
    }
    const tail = rawText.slice(lastIndex);
    if (tail.trim()) {
      segments.push({ pageNumber: currentPageNo, text: tail, provenanceStatus: 'verified' });
    }
    if (segments.length > 0) return segments;
  }

  // 3. Legacy single-string input without page markers
  const explicitSinglePage = options.pageNumber !== undefined && options.pageNumber !== null
    ? Number(options.pageNumber)
    : null;

  return [{
    pageNumber: explicitSinglePage || 1,
    text: rawText,
    provenanceStatus: explicitSinglePage ? 'verified' : 'unavailable'
  }];
}

/**
 * Extracts individual past exam questions from page-structured or raw text input.
 * Preserves:
 * - `pageNumber` (start page) and `pageEnd` (end page for multi-page questions)
 * - `pageProvenanceStatus` ('verified' | 'unavailable')
 * - `questionNumber`, `sectionLabel`, `questionText`, `cleanQuestionText`, `marks`, `subparts`
 * - Multi-page question continuation without splitting a single continuing question
 * - Subparts `(a)`, `(b)`, `(i)`, `(ii)` grouped with their parent question stem unless `options.splitSubquestions` is set
 */
function parsePyqDocumentToQuestions(rawInput, options = {}) {
  const pages = normalizePyqInputToPages(rawInput, options);
  if (pages.length === 0) return [];

  const combinedFullText = pages.map((p) => p.text).join('\n');
  if (!combinedFullText.trim()) return [];

  const defaultSubject = options.subject || null;
  const defaultSubjectCode = options.subjectCode || null;
  const defaultSemesterNo = parseSemesterNumber(options.semesterNo || options.semester);
  const defaultExamYear = options.examYear || extractExamYear(combinedFullText) || '2080 BS';
  const defaultExamType = options.examType || extractExamType(combinedFullText) || 'Final Exam';
  const splitSubquestions = Boolean(options.splitSubquestions);

  const questions = [];

  let currentSection = null;
  let currentQNum = null;
  let currentBuffer = [];
  let currentMarks = null;
  let currentSubpartMarksSum = 0;
  let currentSubparts = [];
  let currentStartPage = pages[0].pageNumber || 1;
  let currentEndPage = currentStartPage;
  let currentProvenanceStatus = pages[0].provenanceStatus || 'verified';

  const flushQuestion = () => {
    if (!currentQNum || currentBuffer.length === 0) return;
    const fullQText = currentBuffer.join(' ').replace(/\s+/g, ' ').trim();
    if (!fullQText || fullQText.length < 5) return;

    const detectedMarks = currentMarks !== null
      ? currentMarks
      : (currentSubpartMarksSum > 0 ? currentSubpartMarksSum : (extractMarksFromText(fullQText) || 5));
    const cleanText = cleanQuestionText(fullQText);
    const category = categorizeQuestion(cleanText);
    const extractedTopic = extractCandidateTopic(cleanText);
    const startPage = currentStartPage || 1;
    const endPage = Math.max(startPage, currentEndPage || startPage);
    const provStatus = currentProvenanceStatus || 'verified';

    questions.push({
      questionNumber: currentQNum,
      sectionLabel: currentSection,
      questionText: fullQText,
      cleanQuestionText: cleanText,
      marks: detectedMarks,
      subparts: currentSubparts.slice(),
      questionCategory: category,
      primaryTopic: extractedTopic.topic,
      normalizedTopic: extractedTopic.normalizedTopic,
      unitNumber: options.unitNumber || null,
      chapterTitle: options.chapterTitle || null,
      subject: defaultSubject,
      subjectCode: defaultSubjectCode,
      semesterNo: defaultSemesterNo,
      examYear: defaultExamYear,
      examType: defaultExamType,
      pageNumber: startPage,
      pageStart: startPage,
      pageEnd: endPage,
      pageRange: formatPageRangeLabel(startPage, endPage, provStatus),
      pageProvenanceStatus: provStatus,
      contentFingerprint: computeContentFingerprint(`${defaultExamYear}|${defaultExamType}|${currentQNum}|${cleanText}`)
    });

    currentBuffer = [];
    currentMarks = null;
    currentSubpartMarksSum = 0;
    currentSubparts = [];
  };

  const sectionRegex = /^(?:group\s+[a-z0-9]+|section\s+[a-z0-9]+|part\s+[a-z0-9]+|long\s+(?:answer\s+)?questions?|short\s+(?:answer\s+)?questions?|very\s+short\s+questions?|brief\s+questions?|comprehensive\s+questions?)(?:\s*[:\-–—(].*)?$/i;

  // Matches top-level question starts:
  // "1.", "1)", "1:-", "[1]", "Q.1", "Q1.", "Q. 1 (a)", "Question 1:"
  const qStartRegex = /^(?:q(?:uestion)?\s*\.?\s*(\d{1,2}(?:\s*\([a-d]\))?)\s*[\.\):-]?|\[(\d{1,2})\]\s*|\b(\d{1,2})\s*[\.\):-]+\s*(?:\(([a-d])\))?|\b(\d{1,2}\s*\([a-d]\))\s*[\.\):-]?)\s*(.*)$/i;

  // Matches letter or Roman numeral subparts on a new line:
  // "(a) ...", "a) ...", "(i) ...", "i) ...", "(ii) ...", "ii. ..."
  const subQRegex = /^(?:\(([a-d]|[ivx]{1,4})\)|([a-d]|[ivx]{1,4})[\.\)])\s+(.*)$/i;

  for (const pageObj of pages) {
    const pageNo = Number(pageObj.pageNumber) || 1;
    const provStatus = pageObj.provenanceStatus || 'verified';
    const lines = String(pageObj.text || '').replace(/\r/g, '').split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^#{1,6}\s+/, '');
      if (!line) continue;

      // Detect Section / Group header before skipping general university headers
      if (sectionRegex.test(line) && line.length < 85) {
        flushQuestion();
        currentSection = line;
        continue;
      }

      // Skip university headers, footers, page numbers, and continuation banners between pages
      if (isUniversityHeaderOrFooterLine(line)) {
        continue;
      }

      // Check Subpart line first so "i) ..." or "a) ..." isn't misread
      const subMatch = line.match(subQRegex);
      if (subMatch && currentQNum) {
        const subLabel = `(${(subMatch[1] || subMatch[2]).toLowerCase()})`;
        const subRemainder = subMatch[3] || '';

        if (!splitSubquestions) {
          // Keep subparts (a), (b), (i), (ii) attached to the parent question so subquestions are not separated
          currentSubparts.push(subLabel);
          currentBuffer.push(`${subLabel} ${subRemainder}`.trim());
          currentEndPage = Math.max(currentEndPage, pageNo);
          const subMarks = extractMarksFromText(subRemainder);
          if (subMarks !== null) {
            currentSubpartMarksSum += subMarks;
          }
          continue;
        }

        // Only if options.splitSubquestions is explicitly true:
        const bufferText = currentBuffer.join(' ').trim();
        const isStemIntro = bufferText.endsWith(':') || /(?:following|algorithms? for|explain both|write notes? on):?$/i.test(bufferText);
        if (isStemIntro) {
          currentSubparts.push(subLabel);
          currentBuffer.push(`${subLabel} ${subRemainder}`.trim());
          currentEndPage = Math.max(currentEndPage, pageNo);
          const m = extractMarksFromText(subRemainder);
          if (m !== null) currentSubpartMarksSum += m;
          continue;
        }
        if (currentBuffer.length > 0) {
          flushQuestion();
        }
        const baseNum = currentQNum.replace(/\([a-z0-9]+\)/i, '');
        currentQNum = `${baseNum}${subLabel}`;
        currentStartPage = pageNo;
        currentEndPage = pageNo;
        currentProvenanceStatus = provStatus;
        currentBuffer.push(subRemainder);
        const m = extractMarksFromText(subRemainder);
        if (m !== null) currentMarks = m;
        continue;
      }

      // Check top-level Question Start
      const qMatch = line.match(qStartRegex);
      if (qMatch) {
        const rawNumPart = (qMatch[1] || qMatch[2] || qMatch[3] || qMatch[5] || '').replace(/\s+/g, '');
        const inlineSubPart = qMatch[4] ? `(${qMatch[4].toLowerCase()})` : '';
        const candidateQNum = `${rawNumPart}${inlineSubPart}`.trim();
        const remainder = (qMatch[6] || '').trim();

        // Guard against a bare number inside a mathematical expression or year at start of continuation line
        const isPlausibleQuestionStart =
          remainder.length >= 3 ||
          /^q(?:uestion)?/i.test(line) ||
          !currentQNum;

        if (isPlausibleQuestionStart) {
          // Check if this is an inline subpart (e.g. 2(a)) under an already-open parent question 2:
          const inlineSubMatch = candidateQNum.match(/^(\d+)\(([a-d]|[ivx]{1,4})\)$/i);
          if (!splitSubquestions && inlineSubMatch && currentQNum === inlineSubMatch[1]) {
            const currentBase = currentQNum;
            if (currentBase === inlineSubMatch[1]) {
              const subLbl = `(${inlineSubMatch[2].toLowerCase()})`;
              if (currentSubparts.length === 0 && /\([a-z0-9]+\)$/i.test(currentQNum)) {
                const firstSub = currentQNum.match(/(\([a-z0-9]+\))$/i)[1];
                currentSubparts.push(firstSub);
                currentQNum = currentBase;
              }
              currentSubparts.push(subLbl);
              currentBuffer.push(`${subLbl} ${remainder}`.trim());
              currentEndPage = Math.max(currentEndPage, pageNo);
              const subM = extractMarksFromText(remainder);
              if (subM !== null) currentSubpartMarksSum += subM;
              continue;
            }
          }

          flushQuestion();
          currentQNum = candidateQNum;
          currentStartPage = pageNo;
          currentEndPage = pageNo;
          currentProvenanceStatus = provStatus;
          if (inlineSubPart) {
            currentSubparts.push(inlineSubPart);
          }
          if (remainder) {
            currentBuffer.push(remainder);
            const m = extractMarksFromText(remainder);
            if (m !== null) currentMarks = m;
          }
          continue;
        }
      }

      // Continuation line of the current question (possibly across a page boundary!)
      if (currentQNum) {
        currentBuffer.push(line);
        currentEndPage = Math.max(currentEndPage, pageNo);
        const m = extractMarksFromText(line);
        if (m !== null) currentMarks = m;
      }
    }
  }

  flushQuestion();

  // Fallback paragraph segmentation if no numbered questions matched
  if (questions.length === 0) {
    let fallbackIndex = 1;
    for (const pageObj of pages) {
      const pageNo = Number(pageObj.pageNumber) || 1;
      const provStatus = pageObj.provenanceStatus || 'verified';
      const paragraphs = String(pageObj.text || '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 20 && !isUniversityHeaderOrFooterLine(p));

      for (const para of paragraphs) {
        const detectedMarks = extractMarksFromText(para) || 5;
        const cleanText = cleanQuestionText(para);
        const extractedTopic = extractCandidateTopic(cleanText);
        const qNum = String(fallbackIndex++);
        questions.push({
          questionNumber: qNum,
          sectionLabel: null,
          questionText: para,
          cleanQuestionText: cleanText,
          marks: detectedMarks,
          subparts: [],
          questionCategory: categorizeQuestion(cleanText),
          primaryTopic: extractedTopic.topic,
          normalizedTopic: extractedTopic.normalizedTopic,
          unitNumber: options.unitNumber || null,
          chapterTitle: options.chapterTitle || null,
          subject: defaultSubject,
          subjectCode: defaultSubjectCode,
          semesterNo: defaultSemesterNo,
          examYear: defaultExamYear,
          examType: defaultExamType,
          pageNumber: pageNo,
          pageStart: pageNo,
          pageEnd: pageNo,
          pageRange: formatPageRangeLabel(pageNo, pageNo, provStatus),
          pageProvenanceStatus: provStatus,
          contentFingerprint: computeContentFingerprint(`${defaultExamYear}|${defaultExamType}|${qNum}|${cleanText}`)
        });
      }
    }
  }

  return questions;
}

function isUniversityHeaderOrFooterLine(line) {
  const norm = String(line || '').toLowerCase().trim();
  if (!norm) return true;
  if (/^(?:page\s+\d+(?:\s+of\s+\d+)?|-\s*\d+\s*-|\[\s*page\s+\d+\s*\]|contd\.?.*|continued\s+on\s+next\s+page.*|p\.?\s*t\.?\s*o\.?|turn\s+over|\*{3,}|-{3,})$/i.test(norm)) {
    return true;
  }
  if (/^(?:group\s+[a-z0-9]+|section\s+[a-z0-9]+|part\s+[a-z0-9]+)/i.test(norm)) {
    return false;
  }
  return (
    norm.includes('gandaki university') ||
    norm.includes('bachelor of information technology') ||
    norm.startsWith('time:') ||
    norm.startsWith('full marks:') ||
    norm.startsWith('pass marks:') ||
    norm.includes('candidates are required to give') ||
    norm.includes('attempt all questions') ||
    norm.includes('attempt any') ||
    norm.includes('figures in the margin indicate')
  );
}

function extractExamYear(text) {
  const m = String(text || '').match(/\b(20[789]\d(?:\s*BS)?|202[0-9](?:\s*AD)?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractExamType(text) {
  const norm = String(text || '').toLowerCase();
  if (norm.includes('pre-board') || norm.includes('pre board')) return 'Pre-Board Exam';
  if (norm.includes('mid-term') || norm.includes('mid term') || norm.includes('midterm')) return 'Mid-Term Exam';
  if (norm.includes('terminal')) return 'Terminal Exam';
  if (norm.includes('model question')) return 'Model Exam';
  if (norm.includes('final') || norm.includes('board examination') || norm.includes('end semester')) return 'Final Exam';
  return 'Final Exam';
}

function extractMarksFromText(text) {
  const m = String(text || '').match(/(?:\[|\()(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*)(?:\s*=\s*(\d+(?:\.\d+)?))?(?:\s*marks?)?(?:\]|\))/i);
  if (!m) return null;
  if (m[2]) return Math.round(Number(m[2]));
  const sumParts = m[1].split('+').map((s) => Number(s.trim()));
  const total = sumParts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return Math.round(total) || 5;
}

function cleanQuestionText(raw) {
  return String(raw || '')
    .replace(/(?:\[|\()\s*\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*(?:\s*=\s*\d+)?(?:\s*marks?)?\s*(?:\]|\))/gi, '')
    .replace(/^q(?:uestion)?\.?\s*\d+(?:\s*\([a-z0-9]+\))?[\s.:-]*/i, '')
    .replace(/^\d+[\s.):-]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function categorizeQuestion(text) {
  const norm = String(text || '').toLowerCase();
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
    norm.includes('mathematical induction') ||
    norm.includes('inductive step')
  ) {
    return 'derivation';
  }
  return 'theory';
}

function extractCandidateTopic(cleanText) {
  const norm = normalizeText(cleanText);

  for (const c of CONCEPT_TAXONOMY) {
    for (const alias of [c.canonical.toLowerCase(), ...c.aliases]) {
      if (norm.includes(alias)) {
        return { topic: c.canonical, normalizedTopic: normalizeText(c.canonical) };
      }
    }
  }

  const patternMatch = cleanText.match(/(?:what is|define|explain|describe|illustrate|discuss|write notes? on|short note on|working of|architecture of)\s+([A-Za-z0-9\s/()-]{3,50}?)(?:\?|\.|,|with|in|using|for|and|$)/i);
  if (patternMatch && patternMatch[1]) {
    const rawTopic = patternMatch[1].trim();
    if (rawTopic.length >= 3 && !/^(?:the|a|an|it|this|that|following)$/i.test(rawTopic)) {
      return { topic: rawTopic, normalizedTopic: normalizeText(rawTopic) };
    }
  }

  const words = cleanText.split(/\s+/).filter((w) => w.length > 2 && !/^(?:what|how|why|when|where|which|explain|define|describe|write|give|with|state)$/i.test(w));
  const fallbackTopic = words.slice(0, 4).join(' ');
  return { topic: fallbackTopic || 'General Topic', normalizedTopic: normalizeText(fallbackTopic || 'general') };
}

function containsConceptTerm(normText, term) {
  if (!normText || !term) return false;
  return normText.includes(term);
}

/**
 * Builds an enriched semantic text representation for a syllabus topic so its embedding
 * captures its unit context, canonical taxonomy aliases, and domain descriptors.
 */
function buildSyllabusTopicSemanticDescription(course, unit, topicTitle) {
  const normTopic = normalizeText(topicTitle);
  const normUnit = normalizeText(unit.title || '');
  const combined = `${normUnit} ${normTopic}`;

  const descriptorTerms = new Set();
  for (const desc of SYLLABUS_SEMANTIC_DESCRIPTORS) {
    if (desc.topicPatterns.some((pat) => combined.includes(normalizeText(pat)))) {
      for (const kw of desc.keywords) descriptorTerms.add(kw);
    }
  }

  for (const concept of CONCEPT_TAXONOMY) {
    const allForms = [concept.canonical.toLowerCase(), ...concept.aliases];
    if (allForms.some((a) => combined.includes(a))) {
      descriptorTerms.add(concept.canonical);
      for (const al of concept.aliases.slice(0, 8)) descriptorTerms.add(al);
      for (const rel of (concept.related || []).slice(0, 5)) descriptorTerms.add(rel);
    }
  }

  return [
    `Unit ${unit.unitNumber}: ${unit.title}`,
    `Syllabus Topic: ${topicTitle}`,
    descriptorTerms.size > 0 ? `Key Concepts: ${Array.from(descriptorTerms).join(', ')}` : ''
  ].filter(Boolean).join(' | ');
}

function computeSemanticContentHash(text) {
  return crypto.createHash('sha256').update(String(text || '').trim(), 'utf8').digest('hex').slice(0, 32);
}

/**
 * Loads or generates cached/persisted embeddings for all syllabus topics of `course`.
 * Reuses the existing embedding provider and dimensions from `lib/semantic-chunker.js`
 * and persists vectors in `syllabus_topic_embeddings` with stable `content_hash` tracking
 * so unchanged topics are never re-embedded while descriptor changes invalidate the cache.
 */
async function getOrBuildSyllabusTopicEmbeddings(db, course) {
  if (!course || !Array.isArray(course.units) || course.units.length === 0) {
    return [];
  }

  const modelInfo = getActiveEmbeddingModelInfo();
  const courseKey = `${course.code || normalizeText(course.title)}|sem${course.semesterNo || 0}`;

  // Build candidate topic entries across all units of the course
  const topicEntries = [];
  const seenKeys = new Set();

  for (const u of course.units || []) {
    const unitTopics = Array.from(new Set([u.title, ...(u.topics || [])])).filter(Boolean);
    for (const t of unitTopics) {
      const normT = normalizeText(t);
      if (!normT || normT.length < 2) continue;
      const topicKey = `${courseKey}|u${u.unitNumber}|${normT}`;
      if (seenKeys.has(topicKey)) continue;
      seenKeys.add(topicKey);

      const semanticText = buildSyllabusTopicSemanticDescription(course, u, t);
      const contentHash = computeSemanticContentHash(semanticText);

      topicEntries.push({
        topicKey,
        subject: course.title,
        subjectCode: course.code || null,
        semesterNo: course.semesterNo || null,
        unitNumber: u.unitNumber,
        unitTitle: u.title,
        topicTitle: t,
        normalizedTopic: normT,
        semanticText,
        contentHash,
        vector: null
      });
    }
  }

  if (topicEntries.length === 0) return [];

  const combinedDescriptorHash = computeSemanticContentHash(
    topicEntries.map((e) => `${e.topicKey}:${e.contentHash}`).join('|')
  );
  const cacheKey = `${courseKey}|${modelInfo.modelName}|${modelInfo.modelVersion}|${modelInfo.dimensions}|${combinedDescriptorHash}`;

  if (syllabusTopicEmbeddingCache.has(cacheKey)) {
    return syllabusTopicEmbeddingCache.get(cacheKey);
  }

  // 1. Check persisted embeddings in `syllabus_topic_embeddings` with content_hash validation
  const persistedByKey = new Map();
  if (db && typeof db.all === 'function') {
    try {
      await ensureRagSchema(db);
      const rows = await db.all(
        `SELECT topic_key, embedding_json, dimensions, content_hash
         FROM syllabus_topic_embeddings
         WHERE subject = ? AND model_name = ? AND model_version = ?`,
        course.title,
        modelInfo.modelName,
        modelInfo.modelVersion
      );
      for (const r of rows || []) {
        if (Number(r.dimensions) === Number(modelInfo.dimensions) && r.embedding_json) {
          try {
            const parsed = JSON.parse(r.embedding_json);
            if (Array.isArray(parsed) && parsed.length === Number(modelInfo.dimensions)) {
              persistedByKey.set(r.topic_key, {
                vector: parsed,
                contentHash: r.content_hash || null
              });
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  const missingEntries = [];
  for (const entry of topicEntries) {
    const cached = persistedByKey.get(entry.topicKey);
    // Reuse cached vector ONLY if content_hash matches the current semantic descriptor text
    if (cached && cached.contentHash && cached.contentHash === entry.contentHash && Array.isArray(cached.vector)) {
      entry.vector = cached.vector;
    } else {
      missingEntries.push(entry);
    }
  }

  // 2. Embed any missing or invalidated syllabus topics in a single batch call and persist them
  if (missingEntries.length > 0) {
    const textsToEmbed = missingEntries.map((e) => e.semanticText);
    const batchRes = await generateEmbeddingsBatch(textsToEmbed);
    const now = new Date().toISOString();

    for (let i = 0; i < missingEntries.length; i++) {
      const entry = missingEntries[i];
      const vec = (batchRes && Array.isArray(batchRes.vectors) && batchRes.vectors[i])
        ? batchRes.vectors[i]
        : computeLocalAcademicEmbedding(entry.semanticText, modelInfo.dimensions);
      entry.vector = vec;

      if (db && typeof db.run === 'function' && Array.isArray(vec) && vec.length > 0) {
        try {
          await db.run(
            `INSERT INTO syllabus_topic_embeddings (
              topic_key, model_name, model_version, subject, subject_code,
              semester_no, unit_number, topic_title, normalized_topic,
              dimensions, embedding_json, content_hash, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (topic_key, model_name, model_version) DO UPDATE SET
              dimensions = excluded.dimensions,
              embedding_json = excluded.embedding_json,
              content_hash = excluded.content_hash,
              updated_at = excluded.updated_at`,
            entry.topicKey,
            batchRes.modelName || modelInfo.modelName,
            batchRes.modelVersion || modelInfo.modelVersion,
            entry.subject,
            entry.subjectCode,
            entry.semesterNo,
            entry.unitNumber,
            entry.topicTitle,
            entry.normalizedTopic,
            vec.length,
            JSON.stringify(vec),
            entry.contentHash,
            now
          );
        } catch (_) {}
      }
    }
  }

  syllabusTopicEmbeddingCache.set(cacheKey, topicEntries);
  return topicEntries;
}

/**
 * Computes lexical + taxonomy/paraphrase overlap between a normalized question and a syllabus topic entry.
 */
function scoreLexicalAndTaxonomyMatch(normQ, semanticCleanQ, topicEntry) {
  const normT = topicEntry.normalizedTopic;
  const uTitleNorm = normalizeText(topicEntry.unitTitle || '');
  if (!normT || normT.length < 2) {
    return { lexicalScore: 0, taxonomyScore: 0 };
  }

  let lexicalScore = 0;
  const uTitleMatch = uTitleNorm.length >= 4 && (
    normQ.includes(uTitleNorm) ||
    uTitleNorm.split(/\s+/).filter((w) => w.length >= 4).every((w) => normQ.includes(w.replace(/s$/, '')))
  );
  const unitBonus = uTitleMatch ? 0.14 : 0;

  if (normT.length >= 4 && normQ.includes(normT)) {
    lexicalScore = Math.min(1.0, 0.78 + Math.min(0.18, normT.length * 0.008) + unitBonus);
  } else {
    const stopWords = new Set(['introduction', 'basic', 'basics', 'concept', 'concepts', 'overview', 'system', 'systems', 'model', 'models', 'and', 'the', 'for', 'with', 'in', 'of', 'to']);
    const tTokens = normT.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
    let tokenHits = 0;
    for (const tok of tTokens) {
      const stem = tok.replace(/(?:es|s|ing|tion|ment)$/, '');
      if (stem.length >= 3 && normQ.includes(stem)) {
        tokenHits += 1;
      }
    }
    if (tTokens.length > 0) {
      const ratio = tokenHits / tTokens.length;
      if (ratio >= 0.75 && tokenHits >= 2) {
        lexicalScore = Math.min(0.90, 0.68 + ratio * 0.15 + unitBonus);
      } else if (ratio >= 0.5 && tokenHits >= 2) {
        lexicalScore = Math.min(0.75, 0.48 + ratio * 0.18 + unitBonus);
      } else if (tokenHits === 1 && tTokens.length === 1 && tTokens[0].length >= 5) {
        lexicalScore = Math.min(0.84, 0.68 + unitBonus);
      } else if (tokenHits >= 1) {
        lexicalScore = Math.min(0.48, tokenHits * 0.20 + unitBonus);
      }
    }
  }

  // Taxonomy & semantic descriptor match (strictly within the candidate topic's domain)
  let taxonomyScore = 0;
  const combinedTopicContext = `${uTitleNorm} ${normT}`;

  for (const desc of SYLLABUS_SEMANTIC_DESCRIPTORS) {
    const topicBelongsToDescriptor = desc.topicPatterns.some((pat) => combinedTopicContext.includes(normalizeText(pat)));
    if (!topicBelongsToDescriptor) continue;

    let kwHits = 0;
    for (const kw of desc.keywords) {
      const nkw = normalizeText(kw);
      if (nkw && normQ.includes(nkw)) {
        kwHits += nkw.includes(' ') ? 2 : 1;
      }
    }
    if (kwHits >= 2) {
      // Bonus when the specific topic title itself (not just the unit title) matches the descriptor pattern
      const directTopicPatternHit = desc.topicPatterns.some((pat) => normT.includes(normalizeText(pat)));
      taxonomyScore = Math.max(
        taxonomyScore,
        Math.min(0.94, 0.58 + kwHits * 0.10 + (directTopicPatternHit ? 0.12 : 0))
      );
    } else if (kwHits === 1) {
      taxonomyScore = Math.max(taxonomyScore, 0.44);
    }
  }

  for (const concept of CONCEPT_TAXONOMY) {
    const allAliases = [concept.canonical.toLowerCase(), ...concept.aliases];
    const topicHasConcept = allAliases.some((a) => combinedTopicContext.includes(normalizeText(a)));
    if (!topicHasConcept) continue;

    const qAliasHits = allAliases.filter((a) => normQ.includes(normalizeText(a))).length;
    const qRelHits = (concept.related || []).filter((r) => normQ.includes(normalizeText(r))).length;
    if (qAliasHits > 0 || qRelHits >= 2) {
      const directTopicConceptHit = allAliases.some((a) => normT.includes(normalizeText(a)));
      const score = Math.min(
        0.92,
        0.55 + qAliasHits * 0.16 + qRelHits * 0.08 + (directTopicConceptHit ? 0.10 : 0)
      );
      taxonomyScore = Math.max(taxonomyScore, score);
    }
  }

  return {
    lexicalScore: Number(lexicalScore.toFixed(4)),
    taxonomyScore: Number(taxonomyScore.toFixed(4))
  };
}

/**
 * Links a PYQ question to official syllabus units/topics and teacher note chunks
 * using combined Lexical + Taxonomy + Semantic Embedding matching with calibrated confidence tiers.
 *
 * Confidence tiers & statuses:
 * - `high` (`AUTO_CONFIRMED`): Strong lexical, taxonomy, or semantic consensus (`calibratedScore >= 0.65`)
 * - `medium` (`CANDIDATE_NEEDS_REVIEW`): Plausible semantic/partial match or ambiguous top-2 tie (`0.42 <= calibratedScore < 0.65`)
 * - `low` (`CANDIDATE_NEEDS_REVIEW`): Weak candidate (`0.26 <= calibratedScore < 0.42`)
 * - `unmapped` (`UNMAPPED`): No topic in the target subject reaches threshold (`calibratedScore < 0.26`)
 */
async function linkPyqQuestionToCurriculum(db, question, options = {}) {
  const registry = loadSyllabusRegistry();
  const rawSubject = String(question.subject || options.subject || '').trim();
  const rawSubjectCode = String(question.subject_code || question.subjectCode || options.subjectCode || '').trim();
  const semNo = parseSemesterNumber(question.semester_no ?? question.semesterNo ?? options.semesterNo);
  const qClean = question.cleanQuestionText || question.clean_question_text || question.questionText || question.question_text || '';
  const semanticCleanQ = normalizeQuestionForSemanticMatching(qClean);
  const normQ = normalizeText(semanticCleanQ || qClean);

  // 1. Identify subject and applicable syllabus strictly within subject/semester constraints
  let matchedCourse = null;
  if (rawSubject || rawSubjectCode) {
    const normSub = normalizeText(rawSubject);
    const normCode = normalizeText(rawSubjectCode);
    matchedCourse = registry.courses.find((c) => {
      if (semNo && c.semesterNo && c.semesterNo !== semNo) {
        // Still allow exact course code or exact title match if caller passed custom semester in test
        if (normCode && normalizeText(c.code) === normCode) return true;
        if (normSub && c.normalizedTitle === normSub) return true;
        return false;
      }
      return (
        (normCode && normalizeText(c.code) === normCode) ||
        (normSub && (c.normalizedTitle === normSub || c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle)))
      );
    });
    if (!matchedCourse && (normSub || normCode)) {
      matchedCourse = registry.courses.find((c) =>
        (normCode && normalizeText(c.code) === normCode) ||
        (normSub && (c.normalizedTitle === normSub || c.normalizedTitle.includes(normSub) || normSub.includes(c.normalizedTitle)))
      );
    }
  } else if (semNo) {
    matchedCourse = registry.courses.find((c) => c.semesterNo === semNo && containsConceptTerm(normQ, c.normalizedTitle));
  }

  // Also include any custom syllabus units/topics from `course_syllabus_topics` for this subject if DB is present
  let effectiveCourse = matchedCourse;
  if (db && typeof db.all === 'function' && (rawSubject || matchedCourse)) {
    try {
      const targetSub = matchedCourse ? matchedCourse.title : rawSubject;
      const customTopicRows = await db.all(
        `SELECT unit_number, topic_title FROM course_syllabus_topics WHERE subject = ? ORDER BY unit_number ASC, step_index ASC`,
        targetSub
      ).catch(() => []);
      if (customTopicRows && customTopicRows.length > 0 && !effectiveCourse) {
        const unitsMap = new Map();
        for (const r of customTopicRows) {
          const uNo = Number(r.unit_number) || 1;
          if (!unitsMap.has(uNo)) {
            unitsMap.set(uNo, { unitNumber: uNo, title: `Unit ${uNo}`, topics: [] });
          }
          unitsMap.get(uNo).topics.push(r.topic_title);
        }
        effectiveCourse = {
          title: rawSubject,
          normalizedTitle: normalizeText(rawSubject),
          code: rawSubjectCode || 'COURSE',
          semesterNo: semNo || 1,
          units: Array.from(unitsMap.values())
        };
      }
    } catch (_) {}
  }

  const explicitUnitNumber = question.unit_number || question.unitNumber || options.unitNumber || null;
  const explicitChapterTitle = question.chapter_title || question.chapterTitle || options.chapterTitle || null;

  let rankedCandidates = [];
  let embeddingFallbackUsed = false;
  const modelInfo = getActiveEmbeddingModelInfo();

  if (effectiveCourse && Array.isArray(effectiveCourse.units) && effectiveCourse.units.length > 0) {
    // 2. Generate/retrieve syllabus topic embeddings and question embedding (with safe fallback on provider failure)
    let topicEntries = [];
    let questionVector = null;

    try {
      topicEntries = await getOrBuildSyllabusTopicEmbeddings(db, effectiveCourse);
      const qBatch = await generateEmbeddingsBatch([
        semanticCleanQ
      ]);
      if (qBatch && Array.isArray(qBatch.vectors) && Array.isArray(qBatch.vectors[0])) {
        questionVector = qBatch.vectors[0];
      }
    } catch (_) {
      embeddingFallbackUsed = true;
      // Build topic entries without vectors so lexical + taxonomy matching proceeds cleanly
      topicEntries = [];
      for (const u of effectiveCourse.units || []) {
        for (const t of Array.from(new Set([u.title, ...(u.topics || [])])).filter(Boolean)) {
          topicEntries.push({
            subject: effectiveCourse.title,
            subjectCode: effectiveCourse.code,
            semesterNo: effectiveCourse.semesterNo,
            unitNumber: u.unitNumber,
            unitTitle: u.title,
            topicTitle: t,
            normalizedTopic: normalizeText(t),
            vector: null
          });
        }
      }
    }

    // 3. Score every syllabus topic candidate within the matched subject
    for (const entry of topicEntries) {
      const { lexicalScore, taxonomyScore } = scoreLexicalAndTaxonomyMatch(normQ, semanticCleanQ, entry);

      let semanticScore = 0;
      if (
        Array.isArray(questionVector) &&
        Array.isArray(entry.vector) &&
        questionVector.length > 0 &&
        questionVector.length === entry.vector.length
      ) {
        const rawCos = cosineSimilarity(questionVector, entry.vector);
        // Normalize cosine similarity into [0, 1] active range
        semanticScore = Number(Math.max(0, Math.min(1, rawCos)).toFixed(4));
      }

      // Calibrated combination of lexical, taxonomy, and semantic signals:
      // - Strong lexical or taxonomy signal anchors the match
      // - Semantic similarity boosts paraphrased questions that share domain concepts
      const maxDirectSignal = Math.max(lexicalScore, taxonomyScore);
      let calibratedScore = 0;
      if (maxDirectSignal >= 0.72) {
        calibratedScore = Math.min(0.98, maxDirectSignal * 0.80 + semanticScore * 0.25);
      } else if (maxDirectSignal >= 0.42) {
        calibratedScore = Math.min(0.90, maxDirectSignal * 0.65 + semanticScore * 0.40);
      } else if (maxDirectSignal > 0) {
        calibratedScore = semanticScore >= 0.45
          ? Math.min(0.75, semanticScore * 0.80 + maxDirectSignal * 0.35)
          : semanticScore * 0.45 + maxDirectSignal * 0.50;
      } else {
        // Zero lexical and zero taxonomy/descriptor overlap: only accept if neural semantic similarity is very strong (>= 0.62)
        calibratedScore = semanticScore >= 0.62 ? semanticScore * 0.75 : semanticScore * 0.30;
      }

      // Slight preference for specific subtopics over broad unit-title-only entries when scores are close
      const isUnitTitleOnly = normalizeText(entry.topicTitle) === normalizeText(entry.unitTitle) && (effectiveCourse.units.find((u) => u.unitNumber === entry.unitNumber)?.topics?.length || 0) > 1;
      if (isUnitTitleOnly && calibratedScore > 0.30) {
        calibratedScore = Math.max(0.28, calibratedScore - 0.03);
      }

      rankedCandidates.push({
        unitNumber: entry.unitNumber,
        unitTitle: entry.unitTitle,
        topicTitle: entry.topicTitle,
        normalizedTopic: entry.normalizedTopic,
        lexicalScore: Number(lexicalScore.toFixed(4)),
        taxonomyScore: Number(taxonomyScore.toFixed(4)),
        semanticScore: Number(semanticScore.toFixed(4)),
        calibratedScore: Number(calibratedScore.toFixed(4))
      });
    }

    rankedCandidates.sort((a, b) => b.calibratedScore - a.calibratedScore || b.lexicalScore - a.lexicalScore || b.semanticScore - a.semanticScore);
  }

  const topCandidate = rankedCandidates[0] || null;
  const secondCandidate = rankedCandidates.find((c) => c !== topCandidate && c.unitNumber !== topCandidate?.unitNumber) || rankedCandidates[1] || null;

  // Detect ambiguity: top 2 candidates from different units are very close (< 0.045 gap) and neither has a strong lexical match (< 0.70)
  const isAmbiguousTie = Boolean(
    topCandidate &&
    secondCandidate &&
    topCandidate.unitNumber !== secondCandidate.unitNumber &&
    topCandidate.lexicalScore < 0.70 &&
    (topCandidate.calibratedScore - secondCandidate.calibratedScore) < 0.045 &&
    secondCandidate.calibratedScore >= 0.38
  );

  let mappingConfidence = 'unmapped';
  let mappingStatus = 'UNMAPPED';
  let bestUnitNumber = explicitUnitNumber;
  let bestChapterTitle = explicitChapterTitle;
  let bestTopic = 'Unmapped Question';
  let bestNormTopic = 'unmapped';
  let relevanceScore = 0.0;
  let bestSemanticScore = 0.0;
  let bestLexicalScore = 0.0;

  if (topCandidate && topCandidate.calibratedScore >= 0.26) {
    bestSemanticScore = topCandidate.semanticScore;
    bestLexicalScore = Math.max(topCandidate.lexicalScore, topCandidate.taxonomyScore);
    relevanceScore = topCandidate.calibratedScore;
    bestUnitNumber = explicitUnitNumber || topCandidate.unitNumber;
    bestChapterTitle = explicitChapterTitle || topCandidate.unitTitle;
    bestTopic = topCandidate.topicTitle;
    bestNormTopic = topCandidate.normalizedTopic;

    if (
      !isAmbiguousTie &&
      (topCandidate.calibratedScore >= 0.65 || topCandidate.lexicalScore >= 0.72 || topCandidate.taxonomyScore >= 0.74)
    ) {
      mappingConfidence = 'high';
      mappingStatus = 'AUTO_CONFIRMED';
    } else if (topCandidate.calibratedScore >= 0.42 || isAmbiguousTie) {
      mappingConfidence = 'medium';
      mappingStatus = 'CANDIDATE_NEEDS_REVIEW';
    } else {
      mappingConfidence = 'low';
      mappingStatus = 'CANDIDATE_NEEDS_REVIEW';
    }
  } else if (!effectiveCourse && (question.primaryTopic || question.primary_topic)) {
    // Fallback when subject is not in the official BIT syllabus registry
    const extracted = extractCandidateTopic(qClean);
    if (extracted.topic && extracted.topic !== 'General Topic') {
      bestTopic = extracted.topic;
      bestNormTopic = extracted.normalizedTopic;
      mappingConfidence = 'medium';
      mappingStatus = 'CANDIDATE_NEEDS_REVIEW';
      relevanceScore = 0.55;
    }
  }

  // Find matching teacher note chunk in `document_chunks` strictly within the same subject if db is available
  let noteFileId = null;
  let noteChunkId = null;
  let notePageNumber = null;

  if (db && typeof db.all === 'function' && mappingConfidence !== 'unmapped' && bestNormTopic && bestNormTopic !== 'unmapped') {
    try {
      await ensureRagSchema(db);
      const targetSubject = effectiveCourse ? effectiveCourse.title : rawSubject;
      const cleanSearch = bestNormTopic.replace(/lists\b/gi, 'list');
      const chunkParams = [`%${cleanSearch}%`, `%${cleanSearch}%`];
      let sql = `SELECT id, file_id, page_start, section_heading, unit, chapter
                 FROM document_chunks
                 WHERE (clean_content LIKE ? OR section_heading LIKE ?)`;
      if (targetSubject) {
        sql += ` AND (subject LIKE ? OR subject_code LIKE ?)`;
        chunkParams.push(`%${targetSubject}%`, `%${rawSubjectCode || targetSubject}%`);
      }
      sql += ` LIMIT 1`;

      let chunkRows = await db.all(sql, ...chunkParams);
      if ((!chunkRows || chunkRows.length === 0) && bestNormTopic) {
        const words = bestNormTopic.split(/\s+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ''));
        if (words.length >= 2) {
          const fallbackParams = words.slice(0, 2).map((w) => `%${w}%`);
          let fbSql = `SELECT id, file_id, page_start, section_heading, unit, chapter
                       FROM document_chunks
                       WHERE (clean_content LIKE ? AND clean_content LIKE ?)`;
          if (targetSubject) {
            fbSql += ` AND (subject LIKE ? OR subject_code LIKE ?)`;
            fallbackParams.push(`%${targetSubject}%`, `%${rawSubjectCode || targetSubject}%`);
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
        if (mappingConfidence === 'high') {
          relevanceScore = Math.max(relevanceScore, 0.92);
        }
      }
    } catch (_) {}
  }

  return {
    subject: effectiveCourse ? effectiveCourse.title : (rawSubject || 'General'),
    subjectCode: effectiveCourse ? effectiveCourse.code : (rawSubjectCode || null),
    semesterNo: semNo || (effectiveCourse ? effectiveCourse.semesterNo : 1),
    unitNumber: bestUnitNumber,
    chapterTitle: bestChapterTitle,
    primaryTopic: bestTopic,
    normalizedTopic: bestNormTopic,
    mappingConfidence,
    mappingStatus,
    isAmbiguous: isAmbiguousTie,
    embeddingFallbackUsed,
    embeddingModel: modelInfo.modelName,
    embeddingDimensions: modelInfo.dimensions,
    semanticScore: bestSemanticScore,
    lexicalScore: bestLexicalScore,
    relevanceScore: Number(relevanceScore.toFixed(4)),
    candidateTopics: rankedCandidates.slice(0, 3),
    noteFileId,
    noteChunkId,
    notePageNumber
  };
}

/**
 * Ingests an entire past paper document into `pyq_papers`, `pyq_questions`, and `pyq_topic_links`.
 * Idempotent: deduplicates repeated ingestions of the same paper and preserves teacher-approved topic mappings.
 */
async function ingestPyqPaper(db, payload = {}) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();

  const fileId = payload.fileId ? Number(payload.fileId) : null;
  const subject = payload.subject || 'General Academic';
  const subjectCode = payload.subjectCode || null;
  const semesterNo = parseSemesterNumber(payload.semesterNo || payload.semester) || 1;
  const rawCombinedText = Array.isArray(payload.pages) && payload.pages.length > 0
    ? payload.pages.map((p) => p.cleaned_text || p.cleanedText || p.raw_text || p.rawText || p.text || '').join('\n\f\n')
    : String(payload.rawText || payload.fullText || '');
  const examYear = payload.examYear || extractExamYear(rawCombinedText) || '2080 BS';
  const examType = payload.examType || extractExamType(rawCombinedText) || 'Final Exam';
  const university = payload.university || 'Gandaki University';
  const title = payload.title || `${subject} (${examYear} ${examType})`;
  const uploadedBy = payload.uploadedBy || null;

  const parsedQuestions = parsePyqDocumentToQuestions(payload.pages || rawCombinedText, {
    pages: payload.pages,
    pageNumber: payload.pageNumber,
    subject,
    subjectCode,
    semesterNo,
    examYear,
    examType,
    unitNumber: payload.unitNumber,
    chapterTitle: payload.chapterTitle,
    splitSubquestions: payload.splitSubquestions
  });

  const normalizedQuestionSig = parsedQuestions
    .map((q) => `${q.questionNumber}:${normalizeText(q.cleanQuestionText)}`)
    .join('||');
  const paperFingerprint = crypto
    .createHash('sha1')
    .update(`${normalizeText(subject)}|${normalizeText(examYear)}|${normalizeText(examType)}|${normalizedQuestionSig}`)
    .digest('hex')
    .slice(0, 28);

  // Check if this paper was already ingested (by explicit paperId, fileId, or identical paper_fingerprint)
  let existingPaper = null;
  if (payload.paperId) {
    existingPaper = await db.get(`SELECT * FROM pyq_papers WHERE id = ?`, payload.paperId).catch(() => null);
  }
  if (!existingPaper && fileId !== null && Number.isFinite(fileId)) {
    existingPaper = await db.get(`SELECT * FROM pyq_papers WHERE file_id = ?`, fileId).catch(() => null);
  }
  if (!existingPaper && paperFingerprint) {
    existingPaper = await db.get(
      `SELECT * FROM pyq_papers WHERE paper_fingerprint = ? AND subject = ? AND exam_year = ? LIMIT 1`,
      paperFingerprint,
      subject,
      examYear
    ).catch(() => null);
  }

  const paperId = payload.paperId || (existingPaper ? existingPaper.id : `pyq_paper_${paperFingerprint.slice(0, 16)}`);

  // Preserve any existing teacher-approved question mappings before refreshing questions for this paperId
  const teacherApprovedByFingerprint = new Map();
  if (existingPaper) {
    const prevQuestions = await db.all(
      `SELECT q.*, l.mapping_status AS link_mapping_status
       FROM pyq_questions q
       LEFT JOIN pyq_topic_links l ON l.question_id = q.id
       WHERE q.paper_id = ?`,
      paperId
    ).catch(() => []);
    for (const pq of prevQuestions || []) {
      if (pq.mapping_status === 'TEACHER_APPROVED' || pq.link_mapping_status === 'TEACHER_APPROVED') {
        const fp = pq.content_fingerprint || computeContentFingerprint(`${pq.exam_year}|${pq.exam_type}|${pq.question_number}|${pq.clean_question_text}`);
        teacherApprovedByFingerprint.set(fp, pq);
      }
    }
    await db.run(`DELETE FROM pyq_topic_links WHERE question_id IN (SELECT id FROM pyq_questions WHERE paper_id = ?)`, paperId).catch(() => {});
    await db.run(`DELETE FROM pyq_questions WHERE paper_id = ?`, paperId).catch(() => {});
    await db.run(`DELETE FROM pyq_papers WHERE id = ?`, paperId).catch(() => {});
  }

  await db.run(
    `INSERT INTO pyq_papers (
      id, file_id, subject, subject_code, semester_no,
      exam_year, exam_type, university, title, total_marks,
      pass_marks, questions_count, extraction_status, paper_fingerprint,
      uploaded_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    paperFingerprint,
    uploadedBy,
    existingPaper ? (existingPaper.created_at || now) : now,
    now
  );

  const savedQuestions = [];

  for (let i = 0; i < parsedQuestions.length; i++) {
    const q = parsedQuestions[i];
    const qId = `pyq_q_${paperId}_${i + 1}`;

    const linked = await linkPyqQuestionToCurriculum(db, q, {
      subject,
      subjectCode,
      semesterNo,
      unitNumber: payload.unitNumber,
      chapterTitle: payload.chapterTitle
    });

    // Respect prior teacher-approved topic override if present
    const approvedPrev = teacherApprovedByFingerprint.get(q.contentFingerprint);
    if (approvedPrev) {
      linked.unitNumber = approvedPrev.unit_number ?? linked.unitNumber;
      linked.chapterTitle = approvedPrev.chapter_title || linked.chapterTitle;
      linked.primaryTopic = approvedPrev.primary_topic || linked.primaryTopic;
      linked.normalizedTopic = approvedPrev.normalized_topic || linked.normalizedTopic;
      linked.mappingConfidence = 'high';
      linked.mappingStatus = 'TEACHER_APPROVED';
      linked.relevanceScore = 1.0;
    }

    const pageStart = q.pageNumber || 1;
    const pageEnd = q.pageEnd || pageStart;
    const pageProvenanceStatus = q.pageProvenanceStatus || 'verified';

    await db.run(
      `INSERT INTO pyq_questions (
        id, paper_id, file_id, subject, subject_code, semester_no,
        exam_year, exam_type, section_label, question_number,
        question_text, clean_question_text, marks, unit_number,
        chapter_title, primary_topic, normalized_topic, difficulty,
        question_category, model_answer_hint, page_number, page_end,
        page_provenance_status, mapping_confidence, mapping_status,
        semantic_score, lexical_score, content_fingerprint, subparts_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      pageStart,
      pageEnd,
      pageProvenanceStatus,
      linked.mappingConfidence,
      linked.mappingStatus,
      linked.semanticScore,
      linked.lexicalScore,
      q.contentFingerprint,
      JSON.stringify(q.subparts || []),
      now
    );

    const linkId = `pyq_link_${qId}`;
    await db.run(
      `INSERT INTO pyq_topic_links (
        id, question_id, subject, subject_code, semester_no,
        unit_number, topic, normalized_topic, note_file_id,
        note_chunk_id, note_page_number, relevance_score,
        mapping_confidence, mapping_status, semantic_score, lexical_score,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      linked.mappingConfidence,
      linked.mappingStatus,
      linked.semanticScore,
      linked.lexicalScore,
      now
    );

    // Enqueue ambiguous / medium-confidence mappings into `kaie_teacher_review_queue` so teachers can review and confirm
    if (linked.mappingStatus === 'CANDIDATE_NEEDS_REVIEW' && linked.primaryTopic !== 'Unmapped Question') {
      const reviewId = `ktrq_pyq_${qId}`;
      try {
        await db.run(
          `INSERT INTO kaie_teacher_review_queue (
            id, course_code, subject, subject_code, semester_no, unit_number,
            review_type, status, candidate_topic_id, topic_title, extracted_concept,
            primary_file_id, primary_file_title, primary_page_start,
            confidence, evidence_summary, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            confidence = excluded.confidence,
            evidence_summary = excluded.evidence_summary,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at`,
          reviewId,
          linked.subjectCode,
          linked.subject,
          linked.subjectCode,
          linked.semesterNo,
          linked.unitNumber,
          'AMBIGUOUS_PYQ_TOPIC_MAPPING',
          linked.normalizedTopic,
          linked.primaryTopic,
          `Q.${q.questionNumber} (${examYear})`,
          String(fileId || paperId),
          title,
          pageStart,
          linked.relevanceScore,
          `PYQ Q.${q.questionNumber} (${examYear} ${examType}) mapped to candidate syllabus topic "${linked.primaryTopic}" with ${linked.mappingConfidence} confidence (${Math.round(linked.relevanceScore * 100)}%).`,
          JSON.stringify({
            questionId: qId,
            paperId,
            questionNumber: q.questionNumber,
            questionText: q.questionText,
            candidateTopics: linked.candidateTopics || []
          }),
          now,
          now
        );
      } catch (_) {}
    }

    savedQuestions.push({
      id: qId,
      ...q,
      ...linked,
      pageNumber: pageStart,
      pageStart,
      pageEnd,
      pageRange: formatPageRangeLabel(pageStart, pageEnd, pageProvenanceStatus),
      pageProvenanceStatus
    });
  }

  return {
    paperId,
    paperFingerprint,
    idempotentReplaced: Boolean(existingPaper),
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
 * Allows a teacher or admin to review and confirm/override a PYQ question's syllabus topic mapping.
 */
async function updatePyqTopicMapping(db, questionId, {
  unitNumber,
  chapterTitle,
  topic,
  resolvedByUserId = 'teacher'
} = {}) {
  if (!db || !questionId || !topic) return null;
  await ensureRagSchema(db);
  const now = new Date().toISOString();
  const normTopic = normalizeText(topic);

  await db.run(
    `UPDATE pyq_questions
     SET unit_number = COALESCE(?, unit_number),
         chapter_title = COALESCE(?, chapter_title),
         primary_topic = ?,
         normalized_topic = ?,
         mapping_confidence = 'high',
         mapping_status = 'TEACHER_APPROVED'
     WHERE id = ?`,
    unitNumber ?? null,
    chapterTitle ?? null,
    topic,
    normTopic,
    String(questionId)
  );

  await db.run(
    `UPDATE pyq_topic_links
     SET unit_number = COALESCE(?, unit_number),
         topic = ?,
         normalized_topic = ?,
         relevance_score = 1.0,
         mapping_confidence = 'high',
         mapping_status = 'TEACHER_APPROVED'
     WHERE question_id = ?`,
    unitNumber ?? null,
    topic,
    normTopic,
    String(questionId)
  );

  await db.run(
    `UPDATE kaie_teacher_review_queue
     SET status = 'APPROVED',
         topic_title = ?,
         resolved_by_user_id = ?,
         resolved_at = ?,
         updated_at = ?
     WHERE id = ?`,
    topic,
    resolvedByUserId,
    now,
    now,
    `ktrq_pyq_${questionId}`
  ).catch(() => {});

  return db.get(`SELECT * FROM pyq_questions WHERE id = ?`, String(questionId));
}

/**
 * Computes topic match score in [0, 1] and confidence label ('high' | 'medium' | 'low' | 'unmapped')
 * between a stored PYQ row and a target topic/query.
 */
function scorePyqTopicConfidence(qRow = {}, targetTopic = '') {
  const storedConfidence = qRow.mapping_confidence || qRow.mappingConfidence || null;
  const storedStatus = qRow.mapping_status || qRow.mappingStatus || null;
  const storedScore = Number(qRow.relevance_score ?? qRow.relevanceScore ?? 0.85);

  const cleanTarget = normalizeText(targetTopic || '');
  if (!cleanTarget || cleanTarget.length < 2) {
    if (storedConfidence === 'unmapped' || storedStatus === 'UNMAPPED') {
      return { topicMatchScore: 0.1, topicConfidence: 'unmapped' };
    }
    if (storedConfidence === 'low') {
      return { topicMatchScore: Math.min(0.42, storedScore), topicConfidence: 'low' };
    }
    if (storedConfidence === 'medium') {
      return { topicMatchScore: Math.min(0.64, Math.max(0.50, storedScore)), topicConfidence: 'medium' };
    }
    return {
      topicMatchScore: storedScore || 0.85,
      topicConfidence: 'high'
    };
  }

  const qNormTopic = normalizeText(qRow.normalized_topic || qRow.primary_topic || '');
  const qNormText = normalizeText(qRow.clean_question_text || qRow.question_text || '');
  const qNormChap = normalizeText(qRow.chapter_title || '');

  const stopWords = new Set([
    'what', 'is', 'are', 'the', 'in', 'of', 'to', 'and', 'for', 'how', 'why', 'explain',
    'define', 'describe', 'give', 'show', 'important', 'questions', 'question', 'pyq',
    'pyqs', 'previous', 'year', 'exam', 'prepare', 'from', 'this', 'topic', 'chapter', 'unit'
  ]);
  const targetTokens = cleanTarget
    .split(/\s+/)
    .map((w) => w.replace(/(?:es|s|ing|ed)$/, ''))
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  if (targetTokens.length === 0) {
    return {
      topicMatchScore: storedScore || 0.85,
      topicConfidence: storedConfidence || 'high'
    };
  }

  const targetPhrase = targetTokens.join(' ');
  let score = 0;

  if (targetPhrase.length >= 3 && (qNormTopic.includes(targetPhrase) || targetPhrase.includes(qNormTopic)) && qNormTopic.length >= 3 && qNormTopic !== 'unmapped') {
    score = Math.max(score, 0.92);
  } else if (targetPhrase.length >= 3 && qNormText.includes(targetPhrase)) {
    score = Math.max(score, 0.85);
  } else {
    let topicHits = 0;
    let textHits = 0;
    let chapHits = 0;
    for (const tok of targetTokens) {
      if (qNormTopic.includes(tok)) topicHits += 1;
      if (qNormText.includes(tok)) textHits += 1;
      if (qNormChap.includes(tok)) chapHits += 1;
    }
    const maxHits = Math.max(topicHits, textHits);
    const coverage = maxHits / targetTokens.length;
    if (coverage >= 0.75) {
      score = topicHits >= textHits ? 0.82 : 0.74;
    } else if (coverage >= 0.5 && maxHits >= 1) {
      score = topicHits > 0 ? 0.62 : 0.54;
    } else if (maxHits >= 1 && targetTokens.length <= 2) {
      score = 0.52;
    } else if (chapHits >= 1) {
      score = 0.35;
    } else {
      score = 0.15;
    }
  }

  // Cap query-match confidence by the question's own stored curriculum mapping confidence
  // when matching via `normalized_topic` (unless the question text itself directly contains the queried phrase)
  if (storedConfidence === 'low' && !qNormText.includes(targetPhrase)) {
    score = Math.min(score, 0.42);
  } else if (storedConfidence === 'unmapped' && !qNormText.includes(targetPhrase)) {
    score = Math.min(score, 0.25);
  }

  const rounded = Number(Math.min(1, score).toFixed(2));
  const confidence = rounded >= 0.68 ? 'high' : (rounded >= 0.50 ? 'medium' : 'low');
  return {
    topicMatchScore: rounded,
    topicConfidence: confidence
  };
}

/**
 * Searches past exam questions with curriculum, note linking, page/range provenance, and authorization filtering.
 */
async function searchPyqQuestions(db, filters = {}) {
  await ensureRagSchema(db);

  const whereClauses = [];
  const params = [];

  if (filters.subject && filters.subjectCode) {
    whereClauses.push(`(q.subject LIKE ? OR q.subject_code LIKE ? OR q.subject_code = ?)`);
    params.push(`%${filters.subject}%`, `%${filters.subject}%`, filters.subjectCode);
  } else if (filters.subject) {
    whereClauses.push(`(q.subject LIKE ? OR q.subject_code LIKE ?)`);
    params.push(`%${filters.subject}%`, `%${filters.subject}%`);
  } else if (filters.subjectCode) {
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

  if (filters.mappingStatus) {
    whereClauses.push(`q.mapping_status = ?`);
    params.push(filters.mappingStatus);
  }

  if (filters.mappingConfidence) {
    whereClauses.push(`q.mapping_confidence = ?`);
    params.push(filters.mappingConfidence);
  }

  if (filters.unmappedOnly) {
    whereClauses.push(`(q.mapping_status = 'UNMAPPED' OR q.mapping_confidence = 'unmapped' OR q.normalized_topic = 'unmapped')`);
  }

  if (filters.query) {
    const qNorm = normalizeText(filters.query);
    whereClauses.push(`(q.clean_question_text LIKE ? OR q.primary_topic LIKE ? OR q.chapter_title LIKE ?)`);
    params.push(`%${qNorm}%`, `%${qNorm}%`, `%${qNorm}%`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 15));
  const offset = Math.max(0, Number(filters.offset) || 0);

  const querySql = `
    SELECT
      q.id, q.paper_id, q.file_id, q.subject, q.subject_code, q.semester_no,
      q.exam_year, q.exam_type, q.section_label, q.question_number,
      q.question_text, q.clean_question_text, q.marks, q.unit_number,
      q.chapter_title, q.primary_topic, q.normalized_topic, q.difficulty,
      q.question_category, q.model_answer_hint, q.page_number, q.page_end,
      q.page_provenance_status, q.mapping_confidence, q.mapping_status,
      q.semantic_score, q.lexical_score, q.content_fingerprint, q.subparts_json,
      p.title AS paper_title, p.file_id AS paper_file_id, p.uploaded_by AS paper_uploaded_by,
      p.paper_fingerprint,
      l.note_file_id, l.note_chunk_id, l.note_page_number, l.relevance_score
    FROM pyq_questions q
    LEFT JOIN pyq_papers p ON p.id = q.paper_id
    LEFT JOIN pyq_topic_links l ON l.question_id = q.id
    ${whereSql}
    ORDER BY q.exam_year DESC, q.unit_number ASC, q.marks DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const rawRows = (await db.all(querySql, ...params)) || [];
  if (rawRows.length === 0) return [];

  const candidateFileIds = Array.from(new Set(
    rawRows
      .flatMap((r) => [r.file_id, r.paper_file_id, r.note_file_id])
      .filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
      .map((id) => String(id).trim())
  ));

  const fileMap = new Map();
  if (candidateFileIds.length > 0) {
    const placeholders = candidateFileIds.map(() => '?').join(',');
    const fileRows = await db.all(
      `SELECT *
       FROM files
       WHERE CAST(id AS TEXT) IN (${placeholders})`,
      ...candidateFileIds
    ).catch(() => []);
    for (const f of fileRows || []) {
      fileMap.set(String(f.id), f);
    }
  }

  const academicContext = filters.academicContext || null;
  const allowCrossSemester = Boolean(filters.allowCrossSemester);
  const targetTopicForConfidence = filters.targetTopic || filters.normalizedTopic || filters.query || '';
  const minConfidenceScore = typeof filters.minTopicScore === 'number'
    ? filters.minTopicScore
    : (filters.rejectWeakMatches ? 0.50 : 0);

  const authorizedRows = [];
  const seenQuestionIds = new Set();

  for (const row of rawRows) {
    if (seenQuestionIds.has(row.id)) continue;

    const sourceFileId = row.file_id || row.paper_file_id || null;
    const sourceFile = sourceFileId !== null ? fileMap.get(String(sourceFileId)) : null;
    const linkedNoteFile = row.note_file_id ? fileMap.get(String(row.note_file_id)) : null;

    if (sourceFile && (sourceFile.deleted_at || sourceFile.hidden_at || ['removed', 'hidden'].includes(sourceFile.moderation_status))) {
      continue;
    }

    if (academicContext && typeof canReadResource === 'function') {
      const authCtx = academicContext.authenticated !== undefined
        ? academicContext
        : { ...academicContext, authenticated: true };
      const resourceToCheck = sourceFile || {
        id: sourceFileId || row.paper_id || row.id,
        subject: row.subject,
        semester_no: row.semester_no,
        semester: row.semester_no ? `Semester ${row.semester_no}` : null,
        cohort_id: null,
        audience_scope: 'all_students',
        visibility: 'everyone',
        uploadedBy: row.paper_uploaded_by || null
      };
      if (!canReadResource(authCtx, resourceToCheck, 'note', { allowCrossSemester })) {
        continue;
      }
    }

    const { topicMatchScore, topicConfidence } = scorePyqTopicConfidence(row, targetTopicForConfidence);
    if (minConfidenceScore > 0 && topicMatchScore < minConfidenceScore) {
      continue;
    }
    if (filters.rejectWeakMatches && (row.mapping_confidence === 'low' || row.mapping_confidence === 'unmapped')) {
      continue;
    }

    seenQuestionIds.add(row.id);

    const provStatus = row.page_provenance_status || 'verified';
    const pageStart = provStatus === 'unavailable' ? null : (Number(row.page_number) || 1);
    const pageEnd = provStatus === 'unavailable' ? null : (Number(row.page_end) || pageStart);
    const pageRange = formatPageRangeLabel(pageStart, pageEnd, provStatus);

    authorizedRows.push({
      ...row,
      page_number: pageStart,
      page_end: pageEnd,
      page_range: pageRange,
      page_provenance_status: provStatus,
      paper_title: row.paper_title || (sourceFile ? (sourceFile.title || sourceFile.originalName) : `${row.subject || 'Course'} (${row.exam_year || 'Past'} ${row.exam_type || 'Exam'})`),
      source_file_id: sourceFile ? Number(sourceFile.id) : (sourceFileId ? Number(sourceFileId) : null),
      source_file_title: sourceFile ? (sourceFile.title || sourceFile.originalName) : (row.paper_title || null),
      note_file_title: linkedNoteFile && !linkedNoteFile.deleted_at && !linkedNoteFile.hidden_at
        ? (linkedNoteFile.title || linkedNoteFile.originalName)
        : null,
      topic_match_score: topicMatchScore,
      topic_confidence: topicConfidence
    });
  }

  return authorizedRows;
}

/**
 * Returns past question frequency and exam repetition analytics for a topic or unit.
 * - Deduplicates repeated paper ingestions so duplicate copies of the same exam paper do not inflate frequency.
 * - Excludes weak (`low`) and `unmapped` topic mappings from confirmed-topic analytics unless `includeUnconfirmed` is true.
 * - Distinguishes multiple questions in a single exam from multi-year repetition (`isRepeatedAcrossYears`).
 */
async function getTopicPyqAnalytics(db, {
  subject,
  subjectCode,
  semesterNo,
  unitNumber,
  normalizedTopic,
  targetTopic,
  query,
  academicContext = null,
  allowCrossSemester = false,
  rejectWeakMatches = false,
  includeUnconfirmed = false,
  minTopicScore = 0
} = {}) {
  await ensureRagSchema(db);

  const rawQuestions = await searchPyqQuestions(db, {
    subject,
    subjectCode,
    semesterNo,
    unitNumber,
    normalizedTopic,
    targetTopic,
    query,
    academicContext,
    allowCrossSemester,
    rejectWeakMatches,
    minTopicScore,
    limit: 80
  });

  // 1. Filter out weak / unmapped questions from confirmed analytics (unless includeUnconfirmed: true)
  const confirmedQuestions = includeUnconfirmed
    ? rawQuestions
    : rawQuestions.filter((q) => {
        const mc = q.mapping_confidence || q.topic_confidence || 'high';
        const ms = q.mapping_status || 'AUTO_CONFIRMED';
        return mc !== 'low' && mc !== 'unmapped' && ms !== 'UNMAPPED';
      });

  // 2. Deduplicate questions across duplicate copies of the same exam paper:
  // Keyed by `(examYear, examType, normalizeText(clean_question_text))` so two different questions
  // in the same exam are both counted, while duplicate uploads of the exact same question in the same exam are counted once!
  const deduplicatedQuestions = [];
  const seenExamQuestionKeys = new Set();
  let duplicateRecordsSkipped = 0;

  for (const q of confirmedQuestions) {
    const yr = String(q.exam_year || q.examYear || 'Unknown').trim().toUpperCase();
    const exType = String(q.exam_type || q.examType || 'Final Exam').trim().toLowerCase();
    const normQText = normalizeText(q.clean_question_text || q.question_text || '');
    const normQNum = String(q.question_number || q.questionNumber || '').trim().toLowerCase().replace(/\s+/g, '');
    const marks = Number(q.marks) || 0;

    // Distinct question numbers (e.g. Q1 vs Q5) or subquestions (e.g. 1(a) vs 2(a)) within the same exam
    // are preserved even if worded identically, while duplicate uploads of the exact same paper/question are deduplicated.
    const dedupKey = normQNum
      ? `${yr}|${exType}|${normQNum}|${marks}|${normQText}`
      : `${yr}|${exType}|${marks}|${normQText}`;

    if (seenExamQuestionKeys.has(dedupKey)) {
      duplicateRecordsSkipped += 1;
      continue;
    }
    seenExamQuestionKeys.add(dedupKey);
    deduplicatedQuestions.push(q);
  }

  const yearMap = new Map();
  const examInstanceSet = new Set();
  const topicFreqMap = new Map();
  const examTypeCounts = {};
  const marksDistribution = {};
  const confidenceBreakdown = { high: 0, medium: 0, low: 0, unmapped: 0 };
  let totalMarks = 0;

  for (const q of deduplicatedQuestions) {
    const yr = q.exam_year || q.examYear || 'Past Exam';
    const exType = q.exam_type || q.examType || 'Final Exam';
    const marks = Number(q.marks) || 5;
    const conf = q.mapping_confidence || q.topic_confidence || 'high';

    examInstanceSet.add(`${yr}|${exType}`);
    if (!yearMap.has(yr)) {
      yearMap.set(yr, {
        examYear: yr,
        questionCount: 0,
        totalMarks: 0,
        questionNumbers: [],
        questions: []
      });
    }
    const yEntry = yearMap.get(yr);
    yEntry.questionCount += 1;
    yEntry.totalMarks += marks;
    yEntry.questionNumbers.push(q.question_number || '1');
    yEntry.questions.push(q);

    examTypeCounts[exType] = (examTypeCounts[exType] || 0) + 1;
    marksDistribution[marks] = (marksDistribution[marks] || 0) + 1;
    if (confidenceBreakdown[conf] !== undefined) {
      confidenceBreakdown[conf] += 1;
    }
    totalMarks += marks;

    const normT = normalizeText(q.normalized_topic || q.primary_topic || 'general');
    if (normT && normT !== 'unmapped') {
      if (!topicFreqMap.has(normT)) {
        topicFreqMap.set(normT, {
          topic: q.primary_topic || q.normalized_topic || 'General Topic',
          normalizedTopic: normT,
          count: 0,
          examYears: new Set(),
          examInstances: new Set(),
          totalMarks: 0,
          highestConfidence: conf,
          questions: []
        });
      }
      const entry = topicFreqMap.get(normT);
      entry.count += 1;
      if (yr) entry.examYears.add(yr);
      entry.examInstances.add(`${yr}|${exType}`);
      entry.totalMarks += marks;
      if (conf === 'high') entry.highestConfidence = 'high';
      entry.questions.push(q);
    }
  }

  const distinctYears = Array.from(yearMap.keys()).sort().reverse();
  const timesAsked = deduplicatedQuestions.length;

  const yearDistribution = {};
  for (const [yr, info] of yearMap.entries()) {
    yearDistribution[yr] = {
      questionCount: info.questionCount,
      totalMarks: info.totalMarks,
      questionNumbers: info.questionNumbers
    };
  }

  // Note: A topic is only marked `isRepeatedAcrossYears: true` when it has appeared across >= 2 distinct exam years
  // (never claiming a topic is frequently repeated across years based on a single examination!).
  const repeatedTopics = Array.from(topicFreqMap.values())
    .map((entry) => ({
      topic: entry.topic,
      normalizedTopic: entry.normalizedTopic,
      timesAsked: entry.count,
      distinctYearsCount: entry.examYears.size,
      distinctExamsCount: entry.examInstances.size,
      examYears: Array.from(entry.examYears).sort().reverse(),
      totalMarks: entry.totalMarks,
      mappingConfidence: entry.highestConfidence,
      isRepeatedAcrossYears: entry.examYears.size >= 2,
      isMultipleInSingleExam: entry.count >= 2 && entry.examYears.size === 1,
      isRepeated: entry.examYears.size >= 2,
      sampleQuestion: entry.questions[0] || null
    }))
    .sort((a, b) => b.distinctYearsCount - a.distinctYearsCount || b.timesAsked - a.timesAsked);

  return {
    timesAsked,
    distinctYearsCount: distinctYears.length,
    distinctExamsCount: examInstanceSet.size,
    isRepeatedAcrossYears: distinctYears.length >= 2,
    examYears: distinctYears,
    yearDistribution,
    marksDistribution,
    confidenceBreakdown,
    duplicateRecordsSkipped,
    examTypes: examTypeCounts,
    averageMarks: timesAsked > 0 ? Number((totalMarks / timesAsked).toFixed(1)) : 0,
    totalMarksWeight: totalMarks,
    repeatedTopics,
    repeatedQuestions: deduplicatedQuestions.filter((q) => {
      const normT = normalizeText(q.normalized_topic || q.primary_topic || '');
      const freq = topicFreqMap.get(normT);
      return Boolean(freq && freq.examYears.size >= 2);
    }),
    topQuestions: deduplicatedQuestions.slice(0, 8)
  };
}

module.exports = {
  SYLLABUS_SEMANTIC_DESCRIPTORS,
  clearSyllabusTopicEmbeddingCache,
  normalizeQuestionForSemanticMatching,
  formatPageRangeLabel,
  parsePyqDocumentToQuestions,
  getOrBuildSyllabusTopicEmbeddings,
  linkPyqQuestionToCurriculum,
  ingestPyqPaper,
  updatePyqTopicMapping,
  searchPyqQuestions,
  getTopicPyqAnalytics,
  scorePyqTopicConfidence,
  extractMarksFromText,
  categorizeQuestion,
  extractCandidateTopic
};
