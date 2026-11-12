'use strict';

const { normalizeText } = require('./academic-document-understanding');

// Common academic synonyms and alternate terminology in CS/Mathematics
const ACADEMIC_TERMINOLOGY_ALIASES = [
  ['proposition', 'statement', 'declarative sentence'],
  ['adt', 'abstract data type'],
  ['dfa', 'deterministic finite automata', 'deterministic finite state automata', 'dfsa'],
  ['nfa', 'non deterministic finite automata', 'non deterministic finite state automata', 'nfsa'],
  ['fsm', 'finite state machine'],
  ['linked list', 'self referential structure', 'singly linked list'],
  ['tautology', 'valid statement', 'universally true'],
  ['contradiction', 'unsatisfiable statement', 'fallacy'],
  ['big o', 'upper bound', 'order of magnitude'],
  ['recursion', 'recursive definition', 'inductive definition'],
  ['root node', 'tree root', 'topmost element']
];

// Patterns indicating explicit contextual domains (language, case, boundary)
const CONTEXT_INDICATORS = [
  { context: 'c_language', regex: /\b(?:in\s+c(?:\s+programming)?|using\s+c|c\s+syntax)\b/i },
  { context: 'java_language', regex: /\b(?:in\s+java|using\s+java|java\s+syntax)\b/i },
  { context: 'python_language', regex: /\b(?:in\s+python|pythonic)\b/i },
  { context: 'best_case', regex: /\b(?:best[\s-]case|minimum\s+comparisons?|omega|already\s+sorted)\b/i },
  { context: 'worst_case', regex: /\b(?:worst[\s-]case|maximum\s+comparisons?|reverse\s+sorted)\b/i },
  { context: 'average_case', regex: /\b(?:average[\s-]case|expected\s+time)\b/i },
  { context: 'content_box', regex: /\bcontent[\s-]box\b/i },
  { context: 'border_box', regex: /\bborder[\s-]box\b/i },
  { context: '1d_array', regex: /\b(?:1d|one[\s-]dimensional|single[\s-]dimensional)\s+array\b/i },
  { context: '2d_array', regex: /\b(?:2d|two[\s-]dimensional|multi[\s-]dimensional)\s+array\b/i }
];

// Core assertion extraction rules: [Concept, Predicate, PositivePattern, NegativePattern]
const CONFLICT_ASSERTION_RULES = [
  {
    concept: 'array_indexing_start',
    conceptLabel: 'Array Indexing Base',
    entityRegex: /\b(?:array\s+(?:index(?:ing)?|indices|subscripts?))\b/i,
    extractAssertion: (text) => {
      if (/\b(?:starts?\s+at|indexed\s+from|base\s+index\s+is|begins?\s+at|starts?\s+from)\s+0\b/i.test(text) ||
          /\b(?:0[\s-]based|from\s+0\s+to\s+n\s*-\s*1)\b/i.test(text)) {
        return { value: '0', polarity: 'zero_based', raw: 'Array indexing starts at 0' };
      }
      if (/\b(?:starts?\s+at|indexed\s+from|base\s+index\s+is|begins?\s+at|starts?\s+from)\s+1\b/i.test(text) ||
          /\b(?:1[\s-]based|from\s+1\s+to\s+n)\b/i.test(text)) {
        return { value: '1', polarity: 'one_based', raw: 'Array indexing starts at 1' };
      }
      return null;
    }
  },
  {
    concept: 'linear_search_sorted_requirement',
    conceptLabel: 'Linear Search Precondition',
    entityRegex: /\b(?:linear\s+search|sequential\s+search)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:does\s+not\s+require|no\s+need\s+for|works\s+on\s+unsorted|neither\s+sorted\s+nor|can\s+be\s+unsorted)\b/i.test(text) ||
          /\b(?:applied\s+on\s+any\s+(?:order|array)|unsorted\s+elements?)\b/i.test(text)) {
        return { value: 'unsorted_allowed', polarity: 'no_sorted_requirement', raw: 'Linear search does not require elements to be sorted' };
      }
      if (/\b(?:requires?\s+(?:a\s+)?sorted|must\s+be\s+sorted|elements?\s+must\s+be\s+in\s+(?:ascending|descending|order))\b/i.test(text) &&
          !/\bbinary\s+search\b/i.test(text)) {
        return { value: 'sorted_mandatory', polarity: 'sorted_requirement_claimed', raw: 'Linear search requires elements to be sorted' };
      }
      return null;
    }
  },
  {
    concept: 'bubble_sort_best_case',
    conceptLabel: 'Bubble Sort Best Case Time Complexity',
    entityRegex: /\b(?:bubble\s+sort)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:best[\s-]case|already\s+sorted)\b/i.test(text)) {
        if (/O\s*\(\s*n\s*\)|O\(n\)/i.test(text) && !/O\s*\(\s*n\s*[\^2²]\s*\)/i.test(text)) {
          return { value: 'O(n)', polarity: 'linear_best_case', raw: 'Best case time complexity of bubble sort is O(n)' };
        }
        if (/O\s*\(\s*n\s*[\^2²]\s*\)|O\(n\^2\)/i.test(text)) {
          return { value: 'O(n^2)', polarity: 'quadratic_best_case', raw: 'Best case time complexity of bubble sort is O(n^2)' };
        }
      }
      return null;
    }
  },
  {
    concept: 'proposition_truth_values',
    conceptLabel: 'Proposition Truth Value States',
    entityRegex: /\b(?:propositions?|statements?)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:either\s+true\s+or\s+false|never\s+both|exactly\s+one\s+truth\s+value|cannot\s+be\s+both)\b/i.test(text)) {
        return { value: 'two_valued_boolean', polarity: 'classical_bivalent', raw: 'A proposition must be strictly true or false, never both' };
      }
      if (/\b(?:can\s+be\s+both\s+true\s+and\s+false|multivalued|fuzzy|may\s+have\s+unknown\s+truth\s+value)\b/i.test(text)) {
        return { value: 'multivalued', polarity: 'non_bivalent', raw: 'A proposition can have unknown or multiple truth values simultaneously' };
      }
      return null;
    }
  },
  {
    concept: 'stack_discipline',
    conceptLabel: 'Stack Discipline (LIFO vs FIFO)',
    entityRegex: /\b(?:stack(?:s)?)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:lifo|last[\s-]in[\s-]first[\s-]out)\b/i.test(text)) {
        return { value: 'lifo', polarity: 'lifo', raw: 'Stack follows Last-In First-Out (LIFO) discipline' };
      }
      if (/\b(?:fifo|first[\s-]in[\s-]first[\s-]out)\b/i.test(text)) {
        return { value: 'fifo', polarity: 'fifo', raw: 'Stack follows First-In First-Out (FIFO) discipline' };
      }
      return null;
    }
  },
  {
    concept: 'binary_search_sorted_requirement',
    conceptLabel: 'Binary Search Precondition',
    entityRegex: /\b(?:binary\s+search)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:requires?\s+(?:a\s+)?sorted|must\s+be\s+sorted|elements?\s+must\s+be\s+in\s+order)\b/i.test(text)) {
        return { value: 'sorted_mandatory', polarity: 'sorted_required', raw: 'Binary search requires sorted elements' };
      }
      if (/\b(?:does\s+not\s+require|works\s+on\s+unsorted|can\s+be\s+unsorted)\b/i.test(text)) {
        return { value: 'unsorted_allowed', polarity: 'unsorted_claimed', raw: 'Binary search works on unsorted elements' };
      }
      return null;
    }
  },
  {
    concept: 'string_representation',
    conceptLabel: 'String Representation',
    entityRegex: /\b(?:strings?)\b/i,
    extractAssertion: (text) => {
      if (/\b(?:null[\s-]terminated|character\s+arrays?|char\s+array)\b/i.test(text)) {
        return { value: 'char_array', polarity: 'char_array_null_term', raw: 'Strings are null-terminated character arrays' };
      }
      if (/\b(?:immutable\s+objects?|objects?\s+of\s+class\s+String)\b/i.test(text)) {
        return { value: 'object', polarity: 'immutable_object', raw: 'Strings are immutable objects' };
      }
      return null;
    }
  }
];

function areTermsSynonymous(termA, termB) {
  const normA = normalizeText(termA);
  const normB = normalizeText(termB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  for (const group of ACADEMIC_TERMINOLOGY_ALIASES) {
    const hasA = group.some((g) => normA.includes(g) || g.includes(normA));
    const hasB = group.some((g) => normB.includes(g) || g.includes(normB));
    if (hasA && hasB) return true;
  }
  return false;
}

function detectContext(text) {
  const contexts = [];
  for (const c of CONTEXT_INDICATORS) {
    if (c.regex.test(text)) contexts.push(c.context);
  }
  return contexts.length > 0 ? contexts : ['general'];
}

function formatPageProvenanceLabel(start, end, status = null) {
  if (status === 'unavailable') return 'Document Section';
  const s = Number(start);
  const e = Number(end);
  const validStart = Number.isFinite(s) && s > 0;
  const validEnd = Number.isFinite(e) && e > 0;
  if (!validStart && !validEnd) return 'Document Section';
  if (validStart && validEnd && e > s) return `Pages ${s}–${e}`;
  if (validStart) return `Page ${s}`;
  if (validEnd) return `Page ${e}`;
  return 'Document Section';
}

/**
 * Detects whether multiple retrieved academic evidence passages contain genuine contradictions,
 * terminology differences, contextual specializations, or agreement.
 *
 * Guarantees:
 * - Operates strictly on authorized sources (excludes unauthorized files).
 * - Compares distinct files only (`fileIdA !== fileIdB`).
 * - Respects teacher-approved overrides (`kaie_teacher_review_queue`).
 * - Distinguishes genuine contradictions from terminology differences and contextual variants.
 */
async function detectAcademicEvidenceConflicts(db, evidenceChunks = [], options = {}) {
  const validChunks = (Array.isArray(evidenceChunks) ? evidenceChunks : [])
    .filter((c) => {
      if (!c || !c.content || String(c.content).trim().length <= 15) return false;
      if (c.isAuthorized === false || c.authorized === false || c.isUnauthorized === true) return false;
      if (typeof options.canReadResource === 'function') {
        const canRead = options.canReadResource(c, options.academicContext);
        if (!canRead) return false;
      }
      return true;
    });

  if (validChunks.length < 2) {
    return { hasConflict: false, conflicts: [], details: [] };
  }

  // 1. Check existing teacher reviews from kaie_teacher_review_queue or topic_source_mappings
  const teacherResolutions = new Map();
  if (db && typeof db.all === 'function') {
    try {
      const reviewRows = await db.all(
        `SELECT primary_file_id, secondary_file_id, concept_key, status, resolution_note, resolved_at
         FROM kaie_teacher_review_queue
         WHERE status = 'RESOLVED'`
      );
      for (const r of reviewRows || []) {
        const pairKey = [String(r.primary_file_id), String(r.secondary_file_id)].sort().join('|');
        teacherResolutions.set(pairKey, r);
        if (r.concept_key) {
          teacherResolutions.set(`concept:${normalizeText(r.concept_key)}`, r);
        }
      }
    } catch (_) {}
  }

  const conflicts = [];
  const details = [];

  // Group chunks by fileId
  const byFile = new Map();
  for (const ch of validChunks) {
    const fid = String(ch.fileId || ch.file_id || 'unknown');
    if (!byFile.has(fid)) byFile.set(fid, []);
    byFile.get(fid).push(ch);
  }

  const fileIds = Array.from(byFile.keys());
  if (fileIds.length < 2) {
    return { hasConflict: false, conflicts: [], details: [] };
  }

  // Compare file pairs
  for (let i = 0; i < fileIds.length; i++) {
    for (let j = i + 1; j < fileIds.length; j++) {
      const fileIdA = fileIds[i];
      const fileIdB = fileIds[j];
      const chunksA = byFile.get(fileIdA);
      const chunksB = byFile.get(fileIdB);

      // Check if teacher has already resolved a conflict between these two files
      const pairKey = [fileIdA, fileIdB].sort().join('|');
      const teacherReview = teacherResolutions.get(pairKey);
      if (teacherReview) {
        details.push({
          status: 'TEACHER_RESOLVED',
          fileIdA,
          fileIdB,
          resolutionNote: teacherReview.resolution_note,
          resolvedAt: teacherReview.resolved_at
        });
        continue;
      }

      for (const chA of chunksA) {
        for (const chB of chunksB) {
          const textA = String(chA.content || chA.clean_content || '');
          const textB = String(chB.content || chB.clean_content || '');

          for (const rule of CONFLICT_ASSERTION_RULES) {
            if (!rule.entityRegex.test(textA) || !rule.entityRegex.test(textB)) {
              continue;
            }

            const assertA = rule.extractAssertion(textA);
            const assertB = rule.extractAssertion(textB);

            if (!assertA || !assertB) continue;

            const contextsA = detectContext(textA);
            const contextsB = detectContext(textB);
            const sharedContext = contextsA.some((ca) => contextsB.includes(ca)) ||
              (contextsA.includes('general') && contextsB.includes('general'));

            // Check if teacher reviewed this concept specifically
            const conceptTeacherReview = teacherResolutions.get(`concept:${normalizeText(rule.concept)}`);
            if (conceptTeacherReview) {
              details.push({
                status: 'TEACHER_RESOLVED',
                concept: rule.conceptLabel,
                resolutionNote: conceptTeacherReview.resolution_note
              });
              continue;
            }

            // Case 1: Agreement
            if (assertA.polarity === assertB.polarity && assertA.value === assertB.value) {
              details.push({
                status: 'AGREEMENT',
                concept: rule.conceptLabel,
                fileTitleA: chA.fileTitle || chA.documentTitle,
                fileTitleB: chB.fileTitle || chB.documentTitle,
                summary: `Both sources agree on ${rule.conceptLabel} (${assertA.raw}).`
              });
              continue;
            }

            // Case 2: Contextual Specialization (both valid in their own contexts)
            if (!sharedContext) {
              details.push({
                status: 'CONTEXTUAL_DIFFERENCE',
                concept: rule.conceptLabel,
                contexts: { sourceA: contextsA, sourceB: contextsB },
                fileTitleA: chA.fileTitle || chA.documentTitle,
                fileTitleB: chB.fileTitle || chB.documentTitle,
                summary: `Statements on ${rule.conceptLabel} differ because they apply to distinct contexts (${contextsA.join(', ')} vs ${contextsB.join(', ')}).`
              });
              continue;
            }

            // Case 3: Genuine Contradiction under the same context
            const pageLabelA = formatPageProvenanceLabel(chA.pageStart || chA.pageNumber, chA.pageEnd);
            const pageLabelB = formatPageProvenanceLabel(chB.pageStart || chB.pageNumber, chB.pageEnd);
            const titleA = chA.fileTitle || chA.documentTitle || 'Note A';
            const titleB = chB.fileTitle || chB.documentTitle || 'Note B';

            const conflictEntry = {
              status: 'GENUINE_CONFLICT',
              concept: rule.conceptLabel,
              conceptKey: rule.concept,
              sourceA: {
                fileId: fileIdA,
                fileTitle: titleA,
                pageLabel: pageLabelA,
                assertion: assertA.raw
              },
              sourceB: {
                fileId: fileIdB,
                fileTitle: titleB,
                pageLabel: pageLabelB,
                assertion: assertB.raw
              },
              explanation: `Source "${titleA}" (${pageLabelA}) asserts: "${assertA.raw}", whereas Source "${titleB}" (${pageLabelB}) asserts: "${assertB.raw}".`,
              formattedNotice: `**Academic Note — Multiple Source Perspectives:** Your uploaded notes contain differing statements regarding **${rule.conceptLabel}**:\n- **${titleA} (${pageLabelA}):** ${assertA.raw}\n- **${titleB} (${pageLabelB}):** ${assertB.raw}\n*(Both source perspectives are preserved for your examination preparation.)*`
            };

            conflicts.push(conflictEntry);
            details.push(conflictEntry);
          }
        }
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    details
  };
}

module.exports = {
  detectAcademicEvidenceConflicts,
  areTermsSynonymous,
  detectContext,
  formatPageProvenanceLabel
};
