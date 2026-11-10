'use strict';

const crypto = require('crypto');
const { ensureRagSchema } = require('./rag-schema');
const { normalizeText, parseSemesterNumber, CONCEPT_TAXONOMY } = require('./academic-document-understanding');

const DEFAULT_CHILD_CHUNK_CHARS = 650;
const DEFAULT_CHILD_OVERLAP_CHARS = 110;
const DEFAULT_PARENT_CHUNK_CHARS = 2000;
const DEFAULT_EMBEDDING_DIMENSIONS = 256;

let customEmbeddingProvider = null;

/**
 * Allows injecting a custom embedding provider (e.g., for testing, OpenAI, Gemini, or local models).
 */
function setEmbeddingProvider(provider) {
  customEmbeddingProvider = provider;
}

function getActiveEmbeddingModelInfo() {
  if (customEmbeddingProvider && customEmbeddingProvider.modelName) {
    return {
      provider: customEmbeddingProvider.provider || 'custom',
       isNeuralSemanticModel: Boolean(customEmbeddingProvider.isNeuralSemanticModel),
      modelName: customEmbeddingProvider.modelName,
      modelVersion: customEmbeddingProvider.modelVersion || '1',
      dimensions: customEmbeddingProvider.dimensions || DEFAULT_EMBEDDING_DIMENSIONS
    };
  }
  const useGemini = (
    process.env.KYANA_EMBEDDING_PROVIDER === 'gemini' ||
    process.env.ENABLE_LIVE_GEMINI_EMBEDDINGS === 'true'
  ) && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (useGemini) {
    return {
      provider: 'gemini',
      isNeuralSemanticModel: true,
      modelName: process.env.KYANA_EMBEDDING_MODEL || 'gemini-embedding-001',
      modelVersion: process.env.KYANA_EMBEDDING_MODEL_VERSION || '1.0',
      dimensions: 768
    };
  }

  const envModel = process.env.KYANA_EMBEDDING_MODEL || 'kyana-academic-hybrid-v1';
  const envVersion = process.env.KYANA_EMBEDDING_MODEL_VERSION || '1.0';
  const envDims = Number(process.env.KYANA_EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS;
  return {
    provider: 'local_feature_hashing',
    isNeuralSemanticModel: false,
    modelName: envModel,
    modelVersion: envVersion,
    dimensions: envDims
  };
}

function computeContentHash(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || '').replace(/\s+/g, ' ').trim())
    .digest('hex');
}

function estimateTokens(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

function isDefinitionParagraph(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return (
    /\b(?:is defined as|refers to|is a process|is a mechanism|is a technique|means that|can be defined as|definition\s*:)\b/i.test(s) ||
    /^(?:\*\*[A-Za-z0-9\s()-]+\*\*|[A-Z][A-Za-z0-9\s()-]{2,45})\s*(?::|–|-)\s+\S+/.test(s)
  );
}

function containsTableMarkup(text) {
  const s = String(text || '');
  return /\|[^\n]+\|\s*\n\s*\|[-:\s|]+\|/.test(s) || /\[Table:/i.test(s);
}

/**
 * Extracts concept and terminology tags present in a specific chunk.
 */
function extractChunkConcepts(text, sectionHeading = '') {
  const combined = normalizeText(`${sectionHeading || ''} ${text || ''}`);
  const topics = [];
  const terms = [];
  const seenT = new Set();
  const seenTerm = new Set();

  for (const concept of CONCEPT_TAXONOMY) {
    for (const alias of [concept.canonical.toLowerCase(), ...concept.aliases]) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i').test(combined)) {
        if (!seenT.has(concept.canonical.toLowerCase())) {
          seenT.add(concept.canonical.toLowerCase());
          topics.push(concept.canonical);
        }
        if (!seenTerm.has(alias)) {
          seenTerm.add(alias);
          terms.push(alias);
        }
      }
    }
  }

  return { topics: topics.slice(0, 10), terminology: terms.slice(0, 15) };
}

/**
 * Structure-Aware Parent-Child Semantic Chunker (Phase 3.1).
 *
 * Groups document pages and sections by:
 * - Chapter boundaries
 * - Section headings
 * - Paragraph groups & definition + explanation continuity
 * - Tables and their surrounding explanation
 *
 * Produces both `parent` chunks (major section / chapter context) and `child` chunks
 * (specific concept/subsection searchable units linked via `parent_chunk_id`).
 */
function buildSemanticChunks({
  file = {},
  docVersion = 1,
  pages = [],
  sections = [],
  academicMetadata = {},
  options = {}
}) {
  const maxChildChars = Number(options.maxChildChars) || DEFAULT_CHILD_CHUNK_CHARS;
  const overlapChars = Number(options.overlapChars) ?? DEFAULT_CHILD_OVERLAP_CHARS;
  const maxParentChars = Number(options.maxParentChars) || DEFAULT_PARENT_CHUNK_CHARS;

  const fileId = String(file.id || academicMetadata.file_id || '');
  const subject = String(file.subject || academicMetadata.subject || '').trim() || null;
  const subjectCode = academicMetadata.subject_code || null;
  const semesterNo = parseSemesterNumber(file.semester_no ?? file.semester ?? academicMetadata.semester_no);
  const defaultChapter = String(file.chapter || academicMetadata.chapter || '').trim() || null;
  const defaultUnit = academicMetadata.unit || null;
  const cohortId = file.cohort_id ?? null;
  const rawScope = String(file.audience_scope || '').trim();
  const audienceScope = (!cohortId && (!rawScope || rawScope === 'cohort' || rawScope === 'general'))
    ? 'all_students'
    : (rawScope || 'all_students');
  const visibility = file.visibility || 'everyone';
  const uploadedBy = file.uploadedBy || file.uploaded_by || null;

  // Step 1: Build logical structural sections from pages & extracted sections
  const structuralUnits = buildStructuralUnits({ pages, sections, defaultChapter, defaultUnit, fileTitle: file.title || file.originalName });

  const allChunks = [];
  let globalChunkIndex = 0;

  for (const unit of structuralUnits) {
    // Group unit blocks into Parent segments (up to maxParentChars)
    const parentGroups = groupBlocksIntoParents(unit.blocks, maxParentChars);

    for (const pGroup of parentGroups) {
      const parentText = pGroup.map((b) => b.text).join('\n\n').trim();
      if (!parentText) continue;

      const parentPageStart = pGroup[0].pageNumber || unit.pageStart || 1;
      const parentPageEnd = pGroup[pGroup.length - 1].pageNumber || unit.pageEnd || parentPageStart;
      const parentHeading = unit.sectionHeading || file.title || 'Document Section';
      const headingPath = [unit.chapter || defaultChapter, unit.unit || defaultUnit, parentHeading]
        .filter(Boolean)
        .join(' > ');

      const parentId = `chk_${fileId}_v${docVersion}_p_${globalChunkIndex}`;
      const parentClean = cleanChunkText(`${parentHeading}\n${parentText}`);
      const parentConcepts = extractChunkConcepts(parentText, parentHeading);

      const parentChunk = {
        id: parentId,
        file_id: fileId,
        doc_version: docVersion,
        chunk_index: globalChunkIndex++,
        parent_chunk_id: null,
        chunk_level: 'parent',
        page_start: parentPageStart,
        page_end: parentPageEnd,
        chapter: unit.chapter || defaultChapter,
        unit: unit.unit || defaultUnit,
        section_heading: parentHeading,
        heading_path: headingPath,
        content: parentText,
        clean_content: parentClean,
        token_count: estimateTokens(parentText),
        content_hash: computeContentHash(parentClean),
        subject,
        subject_code: subjectCode,
        semester_no: semesterNo,
        cohort_id: cohortId,
        audience_scope: audienceScope,
        visibility,
        uploaded_by: uploadedBy,
        topics: parentConcepts.topics,
        terminology: parentConcepts.terminology,
        has_table: containsTableMarkup(parentText) ? 1 : 0,
        has_definition: isDefinitionParagraph(parentText) ? 1 : 0,
        metadata: {
          title: file.title || file.originalName || '',
          headingPath
        }
      };

      allChunks.push(parentChunk);

      // Step 2: Split parent's blocks into structure-aware Child chunks
      const childUnits = splitBlocksIntoChildChunks(pGroup, {
        maxChildChars,
        overlapChars,
        sectionHeading: parentHeading
      });

      for (const child of childUnits) {
        const childId = `chk_${fileId}_v${docVersion}_c_${globalChunkIndex}`;
        const childHeading = child.subHeading || parentHeading;
        const childHeadingPath = child.subHeading && child.subHeading !== parentHeading
          ? `${headingPath} > ${child.subHeading}`
          : headingPath;
        const childClean = cleanChunkText(`${childHeading}\n${child.text}`);
        const childConcepts = extractChunkConcepts(child.text, childHeading);

        allChunks.push({
          id: childId,
          file_id: fileId,
          doc_version: docVersion,
          chunk_index: globalChunkIndex++,
          parent_chunk_id: parentId,
          chunk_level: 'child',
          page_start: child.pageStart || parentPageStart,
          page_end: child.pageEnd || child.pageStart || parentPageEnd,
          chapter: unit.chapter || defaultChapter,
          unit: unit.unit || defaultUnit,
          section_heading: childHeading,
          heading_path: childHeadingPath,
          content: child.text,
          clean_content: childClean,
          token_count: estimateTokens(child.text),
          content_hash: computeContentHash(childClean),
          subject,
          subject_code: subjectCode,
          semester_no: semesterNo,
          cohort_id: cohortId,
          audience_scope: audienceScope,
          visibility,
          uploaded_by: uploadedBy,
          topics: childConcepts.topics,
          terminology: childConcepts.terminology,
          has_table: containsTableMarkup(child.text) ? 1 : 0,
          has_definition: isDefinitionParagraph(child.text) ? 1 : 0,
          metadata: {
            title: file.title || file.originalName || '',
            headingPath: childHeadingPath,
            parentChunkId: parentId
          }
        });
      }
    }
  }

  return allChunks;
}

function buildStructuralUnits({ pages = [], sections = [], defaultChapter, defaultUnit, fileTitle }) {
  const units = [];
  let currentChapter = defaultChapter;
  let currentUnit = defaultUnit;

  // If explicit structured sections (e.g., from DOCX hierarchy or PDF section parser) exist and have content, use them
  if (Array.isArray(sections) && sections.length > 0 && sections.some((s) => s && s.content && s.content.trim())) {
    for (const sec of sections) {
      const heading = String(sec.heading || fileTitle || 'Section').trim();
      const chMatch = heading.match(/\b(?:chapter|ch\.?)\s*\d+[^\n]*/i);
      if (chMatch) currentChapter = chMatch[0].trim();
      const uMatch = heading.match(/\b(?:unit|module)\s*\d+[^\n]*/i);
      if (uMatch) currentUnit = uMatch[0].trim();

      const blocks = parseTextIntoSemanticBlocks(sec.content || '', sec.pageNumber || sec.pageStart || 1, heading);
      if (blocks.length > 0) {
        units.push({
          chapter: sec.chapter || currentChapter,
          unit: sec.unit || currentUnit,
          sectionHeading: heading,
          pageStart: sec.pageStart || sec.pageNumber || 1,
          pageEnd: sec.pageEnd || sec.pageNumber || 1,
          blocks
        });
      }
    }
    if (units.length > 0) return units;
  }

  // Otherwise construct sections across pages preserving page numbers and heading transitions
  let activeUnit = null;

  for (const page of pages) {
    if (page.is_empty) continue;
    const pageNum = Number(page.page_number || page.pageNumber) || 1;
    const pageText = String(page.cleaned_text || page.raw_text || '').trim();
    if (!pageText) continue;

    const lines = pageText.split('\n');
    let bufferLines = [];
    let currentHeading = activeUnit ? activeUnit.sectionHeading : (fileTitle || 'Introduction');

    const flushBufferToActiveUnit = () => {
      const joined = bufferLines.join('\n').trim();
      bufferLines = [];
      if (!joined) return;
      if (!activeUnit) {
        activeUnit = {
          chapter: currentChapter,
          unit: currentUnit,
          sectionHeading: currentHeading,
          pageStart: pageNum,
          pageEnd: pageNum,
          blocks: []
        };
        units.push(activeUnit);
      }
      activeUnit.pageEnd = pageNum;
      const newBlocks = parseTextIntoSemanticBlocks(joined, pageNum, activeUnit.sectionHeading);
      activeUnit.blocks.push(...newBlocks);
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        bufferLines.push('');
        continue;
      }

      if (isStructuralHeadingLine(line)) {
        flushBufferToActiveUnit();
        const cleanH = line.replace(/^#{1,6}\s+/, '').trim();
        if (/^(?:chapter|ch\.?)\s*\d+/i.test(cleanH)) {
          currentChapter = cleanH;
        } else if (/^(?:unit|module)\s*\d+/i.test(cleanH)) {
          currentUnit = cleanH;
        }
        currentHeading = cleanH;
        activeUnit = {
          chapter: currentChapter,
          unit: currentUnit,
          sectionHeading: currentHeading,
          pageStart: pageNum,
          pageEnd: pageNum,
          blocks: []
        };
        units.push(activeUnit);
      } else {
        bufferLines.push(rawLine);
      }
    }

    flushBufferToActiveUnit();
  }

  return units.filter((u) => u.blocks.length > 0);
}

function isStructuralHeadingLine(line) {
  const s = String(line || '').replace(/^#{1,6}\s+/, '').trim();
  if (!s || s.length < 3 || s.length > 90) return false;
  // Reject bare numbers / slide numbers ("3", "8", "99", "(1)")
  if (/^[([]?\d+[)\].:-]*$/.test(s)) return false;
  // Reject lines starting with bullet symbols or list markers
  if (/^[•●▪❑➢❖◦*\-–—]\s*/.test(s)) return false;
  // Reject lines starting with lowercase or code symbols
  if (/^[a-z<>{}[\]=+;]/.test(s)) return false;
  // Reject wrapped sentence fragments ending in dangling prepositions, articles, conjunctions, or hyphenation
  if (/(?:-|\b(?:of|a|an|the|to|in|on|at|for|from|and|or|by|with|as|into|is|are|was|were|be|that|which|who|our|their|its|non|pre))$/i.test(s)) {
    return false;
  }
  if (/^#{1,6}\s+\S+/.test(String(line || '').trim())) return true;
  if (/^(?:chapter|unit|module|section|lecture)\s+\d+(?:\s*[:.-]\s*\S+.*)?$/i.test(s)) return true;
  if (/^\d+(?:\.\d+){0,2}\s+[A-Z][A-Za-z0-9\s,&/()-]{2,75}$/.test(s) && !/[.;]$/.test(s)) return true;
  // Short ALL-CAPS academic heading (e.g. "JUST-IN-TIME COMPILER", "DEADLOCK PREVENTION")
  if (/^[A-Z][A-Z0-9\s,&/()-]{4,60}$/.test(s) && !/\b(?:SELECT|FROM|WHERE|INSERT|CREATE|TABLE)\b/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Splits a section's text into semantic blocks (keeping definitions + explanations,
 * bullet lists, and tables + captions intact).
 */
function parseTextIntoSemanticBlocks(text, pageNumber, sectionHeading) {
  const rawParagraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks = [];
  let i = 0;

  while (i < rawParagraphs.length) {
    let current = rawParagraphs[i];
    let subHeading = null;

    // Check if paragraph starts with a valid structural sub-heading line
    const firstNewline = current.indexOf('\n');
    if (firstNewline > 0) {
      const firstLine = current.slice(0, firstNewline).trim();
      if (isStructuralHeadingLine(firstLine)) {
        subHeading = firstLine.replace(/^#{1,6}\s+/, '').trim();
      }
    } else if (isStructuralHeadingLine(current) && i + 1 < rawParagraphs.length) {
      // Short standalone structural heading paragraph followed by its explanation paragraph: keep them together!
      subHeading = current.replace(/^#{1,6}\s+/, '').trim();
      current = `${current}\n${rawParagraphs[i + 1]}`;
      i += 1;
    }

    // Keep a short definition paragraph attached to its immediately following explanation/example paragraph
    if (
      isDefinitionParagraph(current) &&
      current.length < 320 &&
      i + 1 < rawParagraphs.length &&
      rawParagraphs[i + 1].length < 450
    ) {
      current = `${current}\n\n${rawParagraphs[i + 1]}`;
      i += 1;
    }

    // Keep table and its immediately following explanation paragraph together
    if (
      containsTableMarkup(current) &&
      i + 1 < rawParagraphs.length &&
      rawParagraphs[i + 1].length < 350
    ) {
      current = `${current}\n\n${rawParagraphs[i + 1]}`;
      i += 1;
    }

    blocks.push({
      text: current,
      pageNumber,
      subHeading: subHeading || sectionHeading || null
    });
    i += 1;
  }

  return blocks;
}

function groupBlocksIntoParents(blocks, maxParentChars) {
  const groups = [];
  let current = [];
  let currentLen = 0;

  for (const b of blocks) {
    if (current.length > 0 && currentLen + b.text.length > maxParentChars) {
      groups.push(current);
      current = [b];
      currentLen = b.text.length;
    } else {
      current.push(b);
      currentLen += b.text.length + 2;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function splitBlocksIntoChildChunks(blocks, { maxChildChars, overlapChars, sectionHeading }) {
  const children = [];
  let currentText = '';
  let currentSubHeading = sectionHeading;
  let pageStart = null;
  let pageEnd = null;

  const flushCurrent = () => {
    const trimmed = currentText.trim();
    if (!trimmed) return;
    children.push({
      text: trimmed,
      subHeading: currentSubHeading,
      pageStart: pageStart || 1,
      pageEnd: pageEnd || pageStart || 1
    });
  };

  for (const block of blocks) {
    const bText = block.text.trim();
    if (!bText) continue;

    if (bText.length > maxChildChars) {
      // Flush accumulated blocks first
      if (currentText.trim()) {
        flushCurrent();
        currentText = '';
        pageStart = null;
      }
      // Split oversized block along sentence boundaries with overlap
      const sentenceSlices = splitOversizedBlockBySentences(bText, maxChildChars, overlapChars);
      for (const slice of sentenceSlices) {
        children.push({
          text: slice,
          subHeading: block.subHeading || sectionHeading,
          pageStart: block.pageNumber || 1,
          pageEnd: block.pageNumber || 1
        });
      }
      continue;
    }

    if (currentText && currentText.length + bText.length + 2 > maxChildChars) {
      flushCurrent();
      // Carry overlap from end of previous chunk if within same heading
      const overlap = overlapChars > 0 ? extractTailOverlap(currentText, overlapChars) : '';
      currentText = overlap ? `${overlap}\n\n${bText}` : bText;
      currentSubHeading = block.subHeading || sectionHeading;
      pageStart = block.pageNumber || pageEnd || 1;
      pageEnd = block.pageNumber || pageStart;
    } else {
      if (!currentText) {
        pageStart = block.pageNumber || 1;
        currentSubHeading = block.subHeading || sectionHeading;
      }
      currentText = currentText ? `${currentText}\n\n${bText}` : bText;
      pageEnd = block.pageNumber || pageEnd || pageStart;
    }
  }

  flushCurrent();
  return children;
}

function splitOversizedBlockBySentences(text, maxChars, overlapChars) {
  const sentences = String(text || '')
    .split(/(?<=[.?!])\s+(?=[A-Z0-9•*-])/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    // Hard slice by word boundaries
    const slices = [];
    const step = Math.max(100, maxChars - overlapChars);
    for (let start = 0; start < text.length; start += step) {
      slices.push(text.slice(start, start + maxChars).trim());
      if (start + maxChars >= text.length) break;
    }
    return slices;
  }

  const slices = [];
  let buf = '';
  for (const sent of sentences) {
    if (buf && buf.length + sent.length + 1 > maxChars) {
      slices.push(buf.trim());
      const tail = overlapChars > 0 ? extractTailOverlap(buf, overlapChars) : '';
      buf = tail ? `${tail} ${sent}` : sent;
    } else {
      buf = buf ? `${buf} ${sent}` : sent;
    }
  }
  if (buf.trim()) slices.push(buf.trim());
  return slices;
}

function extractTailOverlap(text, maxOverlapChars) {
  const s = String(text || '').trim();
  if (s.length <= maxOverlapChars) return s;
  const tail = s.slice(s.length - maxOverlapChars);
  const firstSpace = tail.indexOf(' ');
  return firstSpace > 0 ? tail.slice(firstSpace + 1).trim() : tail.trim();
}

function cleanChunkText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic Academic Semantic Vectorizer (`kyana-academic-hybrid-v1`).
 *
 * Combines:
 * 1. Canonical academic concept subspace (64 dimensions mapped to CONCEPT_TAXONOMY & syllabus domains)
 *    so synonyms like "JIT" <-> "Just-in-Time Compiler" <-> "Dynamic compilation" <-> "Bytecode execution"
 *    share strong positive activation in the exact same semantic dimensions!
 * 2. Word stem / unigram & bigram feature hashing with TF sublinear scaling (192 dimensions)
 * 3. L2 normalization for exact cosine similarity in [-1, 1].
 */
function computeLocalAcademicEmbedding(text, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  const dims = Math.max(64, Number(dimensions) || DEFAULT_EMBEDDING_DIMENSIONS);
  const vec = new Float32Array(dims);
  const norm = normalizeText(text);
  if (!norm) return Array.from(vec);

  const conceptDims = Math.min(64, Math.floor(dims / 4));
  const lexicalDims = dims - conceptDims;

  // 1. Concept Subspace activation
  for (let i = 0; i < CONCEPT_TAXONOMY.length; i++) {
    const concept = CONCEPT_TAXONOMY[i];
    const slot = i % conceptDims;
    const secondarySlot = (i * 7 + 3) % conceptDims;

    let score = 0;
    const allAliases = [concept.canonical.toLowerCase(), ...concept.aliases, ...(concept.nepaliAliases || [])];
    for (const alias of allAliases) {
      if (norm.includes(alias)) {
        score += 2.4;
      }
    }
    for (const rel of concept.related || []) {
      if (norm.includes(rel.toLowerCase())) {
        score += 0.9;
      }
    }
    if (score > 0) {
      vec[slot] += score;
      vec[secondarySlot] += score * 0.6;
    }
  }

  // 2. Lexical + Stem + Bigram + Trigram hashing
  const tokens = norm
    .split(/\s+/)
    .map(stemAcademicToken)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  const tf = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    tf.set(tok, (tf.get(tok) || 0) + 1);
    if (i + 1 < tokens.length) {
      const bg = `${tok}_${tokens[i + 1]}`;
      tf.set(bg, (tf.get(bg) || 0) + 0.85);
    }
    // Character 4-grams for technical terms
    if (tok.length >= 5) {
      for (let c = 0; c <= tok.length - 4; c++) {
        const ng = `#${tok.slice(c, c + 4)}`;
        tf.set(ng, (tf.get(ng) || 0) + 0.35);
      }
    }
  }

  for (const [feature, count] of tf.entries()) {
    const weight = 1 + Math.log(count + 1);
    const h1 = fnv1aHash(feature, 2166136261);
    const h2 = fnv1aHash(feature, 16777619);
    const idx = conceptDims + (h1 % lexicalDims);
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  }

  // L2 Normalize
  let normSq = 0;
  for (let i = 0; i < dims; i++) normSq += vec[i] * vec[i];
  const mag = Math.sqrt(normSq);
  if (mag > 1e-8) {
    for (let i = 0; i < dims; i++) {
      vec[i] = Number((vec[i] / mag).toFixed(6));
    }
  }

  return Array.from(vec);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'what', 'which', 'when', 'where', 'who',
  'how', 'can', 'will', 'into', 'about', 'Give', 'give', 'explain', 'notes',
  'note', 'teach', 'study', 'complete', 'barema', 'deu', 'malai', 'bhaneko', 'ke', 'ho'
]);

function stemAcademicToken(word) {
  let w = String(word || '').toLowerCase().trim();
  if (w.length <= 4) return w;
  if (w.endsWith('ization')) return w.slice(0, -7) + 'ize';
  if (w.endsWith('isation')) return w.slice(0, -7) + 'ize';
  if (w.endsWith('ation')) return w.slice(0, -5);
  if (w.endsWith('ingly')) return w.slice(0, -5);
  if (w.endsWith('ments')) return w.slice(0, -5);
  if (w.endsWith('ment')) return w.slice(0, -4);
  if (w.endsWith('ilers')) return w.slice(0, -5) + 'ile';
  if (w.endsWith('iler')) return w.slice(0, -4) + 'ile';
  if (w.endsWith('ing') && w.length >= 6) return w.slice(0, -3);
  if (w.endsWith('ies') && w.length >= 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length >= 5) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('cs')) return w.slice(0, -1);
  return w;
}

function fnv1aHash(str, seed = 2166136261) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) return 0;
  const len = Math.min(vecA.length, vecB.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-8 ? dot / denom : 0;
}

/**
 * Generates embeddings for a batch of text strings with retry handling and configurable provider.
 */
async function generateEmbeddingsBatch(texts = [], options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const modelInfo = getActiveEmbeddingModelInfo();
  const maxRetries = Number(options.maxRetries) || 2;

  if (customEmbeddingProvider && typeof customEmbeddingProvider.embedBatch === 'function') {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const vectors = await customEmbeddingProvider.embedBatch(texts, modelInfo);
        return {
          vectors,
          modelName: modelInfo.modelName,
          modelVersion: modelInfo.modelVersion,
          dimensions: vectors[0] ? vectors[0].length : modelInfo.dimensions
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  if (modelInfo.provider === 'gemini') {
    try {
      const knowledgeEmbeddings = require('./knowledge-embeddings');
      const vectors = await knowledgeEmbeddings.batchEmbedTexts(texts, {
        taskType: options.taskType || 'RETRIEVAL_DOCUMENT'
      });
      return {
        provider: 'gemini',
        isNeuralSemanticModel: true,
        vectors,
        modelName: modelInfo.modelName,
        modelVersion: modelInfo.modelVersion,
        dimensions: vectors[0] ? vectors[0].length : 768
      };
    } catch (err) {
      if (options.requireNeuralEmbeddings) throw err;
      // Fallback to local feature hashing if Gemini network call fails
    }
  }

  const vectors = texts.map((t) => computeLocalAcademicEmbedding(t, modelInfo.dimensions));
  return {
    provider: 'local_feature_hashing',
    isNeuralSemanticModel: false,
    vectors,
    modelName: modelInfo.modelName,
    modelVersion: modelInfo.modelVersion,
    dimensions: modelInfo.dimensions
  };
}

async function generateQueryEmbedding(queryText, options = {}) {
  const batch = await generateEmbeddingsBatch([String(queryText || '')], options);
  return {
    vector: batch.vectors[0] || [],
    modelName: batch.modelName,
    modelVersion: batch.modelVersion,
    dimensions: batch.dimensions
  };
}

/**
 * Persists semantic chunks and generates/reuses embeddings in batches.
 */
async function persistChunksAndEmbeddings(db, { fileId, docVersion = 1, chunks = [], batchSize = 32 }) {
  await ensureRagSchema(db);
  const now = new Date().toISOString();
  const modelInfo = getActiveEmbeddingModelInfo();

  // Remove old chunks/embeddings for this fileId
  await db.run(`DELETE FROM document_chunks WHERE file_id = ?`, [String(fileId)]);

  // Check reusable embeddings by (content_hash, model_name, model_version) before deleting old embeddings
  const reusableMap = new Map();
  try {
    const existingRows = await db.all(
      `SELECT content_hash, embedding_json, dimensions
       FROM document_embeddings
       WHERE file_id = ? AND model_name = ? AND model_version = ?`,
      [String(fileId), modelInfo.modelName, modelInfo.modelVersion]
    );
    for (const r of existingRows || []) {
      if (r.content_hash && r.embedding_json) {
        reusableMap.set(r.content_hash, r.embedding_json);
      }
    }
  } catch (_) {}

  await db.run(`DELETE FROM document_embeddings WHERE file_id = ?`, [String(fileId)]);

  for (const ch of chunks) {
    await db.run(
      `INSERT INTO document_chunks (
        id, file_id, doc_version, chunk_index, parent_chunk_id, chunk_level,
        page_start, page_end, chapter, unit, section_heading, heading_path,
        content, clean_content, token_count, content_hash,
        subject, subject_code, semester_no, cohort_id, audience_scope,
        visibility, uploaded_by, topics_json, terminology_json,
        has_table, has_definition, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ch.id,
        String(fileId),
        Number(docVersion) || 1,
        ch.chunk_index,
        ch.parent_chunk_id || null,
        ch.chunk_level || 'child',
        ch.page_start ?? 1,
        ch.page_end ?? 1,
        ch.chapter || null,
        ch.unit || null,
        ch.section_heading || null,
        ch.heading_path || null,
        ch.content,
        ch.clean_content,
        ch.token_count || 1,
        ch.content_hash,
        ch.subject || null,
        ch.subject_code || null,
        ch.semester_no ?? null,
        ch.cohort_id ?? null,
        ch.audience_scope || 'general',
        ch.visibility || 'students',
        ch.uploaded_by || null,
        JSON.stringify(ch.topics || []),
        JSON.stringify(ch.terminology || []),
        ch.has_table ? 1 : 0,
        ch.has_definition ? 1 : 0,
        JSON.stringify(ch.metadata || {}),
        now
      ]
    );
  }

  // Generate embeddings for searchable chunks (both child and parent so either can be vector-matched)
  let embeddedCount = 0;
  const toEmbed = [];
  const reusedRecords = [];

  for (const ch of chunks) {
    const cachedJson = reusableMap.get(ch.content_hash);
    if (cachedJson) {
      reusedRecords.push({ chunk: ch, embeddingJson: cachedJson });
    } else {
      toEmbed.push(ch);
    }
  }

  for (const item of reusedRecords) {
    await db.run(
      `INSERT INTO document_embeddings (
        chunk_id, file_id, doc_version, model_name, model_version,
        dimensions, embedding_json, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.chunk.id,
        String(fileId),
        Number(docVersion) || 1,
        modelInfo.modelName,
        modelInfo.modelVersion,
        modelInfo.dimensions,
        item.embeddingJson,
        item.chunk.content_hash,
        now
      ]
    );
    embeddedCount += 1;
  }

  for (let start = 0; start < toEmbed.length; start += batchSize) {
    const batch = toEmbed.slice(start, start + batchSize);
    const texts = batch.map(
      (ch) => `${ch.subject || ''} | ${ch.chapter || ''} | ${ch.section_heading || ''}\n${ch.clean_content || ch.content}`
    );
    const result = await generateEmbeddingsBatch(texts);
    for (let idx = 0; idx < batch.length; idx++) {
      const ch = batch[idx];
      const vec = result.vectors[idx] || [];
      await db.run(
        `INSERT INTO document_embeddings (
          chunk_id, file_id, doc_version, model_name, model_version,
          dimensions, embedding_json, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ch.id,
          String(fileId),
          Number(docVersion) || 1,
          result.modelName,
          result.modelVersion,
          result.dimensions,
          JSON.stringify(vec),
          ch.content_hash,
          now
        ]
      );
      embeddedCount += 1;
    }
  }

  return {
    chunksCount: chunks.length,
    embeddingsCount: embeddedCount,
    reusedEmbeddingsCount: reusedRecords.length,
    modelName: modelInfo.modelName,
    modelVersion: modelInfo.modelVersion
  };
}

/**
 * Regenerates embeddings across all indexed chunks when the embedding model or version changes.
 */
async function regenerateEmbeddingsForModel(db, { batchSize = 32 } = {}) {
  await ensureRagSchema(db);
  const modelInfo = getActiveEmbeddingModelInfo();
  const staleChunks = await db.all(
    `SELECT c.id, c.file_id, c.doc_version, c.subject, c.chapter, c.section_heading, c.clean_content, c.content, c.content_hash
     FROM document_chunks c
     LEFT JOIN document_embeddings e ON e.chunk_id = c.id
     WHERE e.chunk_id IS NULL OR e.model_name != ? OR e.model_version != ?`,
    [modelInfo.modelName, modelInfo.modelVersion]
  );

  let updated = 0;
  const now = new Date().toISOString();

  for (let start = 0; start < (staleChunks || []).length; start += batchSize) {
    const batch = staleChunks.slice(start, start + batchSize);
    const texts = batch.map(
      (ch) => `${ch.subject || ''} | ${ch.chapter || ''} | ${ch.section_heading || ''}\n${ch.clean_content || ch.content}`
    );
    const res = await generateEmbeddingsBatch(texts);
    for (let i = 0; i < batch.length; i++) {
      const ch = batch[i];
      const vec = res.vectors[i] || [];
      await db.run(`DELETE FROM document_embeddings WHERE chunk_id = ?`, [ch.id]);
      await db.run(
        `INSERT INTO document_embeddings (
          chunk_id, file_id, doc_version, model_name, model_version,
          dimensions, embedding_json, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ch.id,
          String(ch.file_id),
          Number(ch.doc_version) || 1,
          res.modelName,
          res.modelVersion,
          res.dimensions,
          JSON.stringify(vec),
          ch.content_hash,
          now
        ]
      );
      updated += 1;
    }
  }

  return { updated, modelName: modelInfo.modelName, modelVersion: modelInfo.modelVersion };
}

module.exports = {
  DEFAULT_CHILD_CHUNK_CHARS,
  DEFAULT_CHILD_OVERLAP_CHARS,
  DEFAULT_PARENT_CHUNK_CHARS,
  DEFAULT_EMBEDDING_DIMENSIONS,
  setEmbeddingProvider,
  getActiveEmbeddingModelInfo,
  computeContentHash,
  buildSemanticChunks,
  computeLocalAcademicEmbedding,
  cosineSimilarity,
  generateEmbeddingsBatch,
  generateQueryEmbedding,
  persistChunksAndEmbeddings,
  regenerateEmbeddingsForModel
};
