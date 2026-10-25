'use strict';

/**
 * Semester Library — A4 PDF Academic Result Report Generator
 *
 * Generates a print-ready, standards-compliant PDF 1.4 document (A4 portrait: 595.28 x 841.89 pt)
 * for an authenticated student's selected semester using only authoritative published results.
 *
 * Design & Compliance Guarantees:
 * - Institution Heading: GANDAKI UNIVERSITY
 * - Platform Attribution: SEMESTER LIBRARY
 * - Document Title: ACADEMIC RESULT REPORT
 * - Student Name, Student ID, Department/Cohort, Semester, and Report Generation Date
 * - Subject-wise exam marks, maximum marks, percentages, and publication status
 *   with proper multi-line text wrapping for long subject names
 * - Accurate semester summary of included published marks
 * - Explicit note that unpublished results are excluded and that the document is an
 *   informational report rather than an official university-issued transcript
 * - Zero fabricated signatures, official seals, or verification codes
 */

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 46;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 515.28 pt

const EXAM_TYPES = [
  'Mid-Term Exam',
  'Pre-Board Exam',
  'Final Exam'
];

/**
 * Sanitizes text for PDF WinAnsi / literal string encoding.
 * Replaces typographic dashes/quotes/bullets with clean ASCII/WinAnsi equivalents
 * and escapes PDF literal string characters: \, (, ).
 */
function sanitizePdfText(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2022|\u00B7/g, '|')
    .replace(/\u00D7/g, 'x')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfLiteral(str) {
  return sanitizePdfText(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Approximate proportional character width factor for Helvetica / Helvetica-Bold.
 */
function estimateCharWidth(ch, isBold = false) {
  const code = ch.charCodeAt(0);
  let base = 0.52;
  if (ch === ' ') base = 0.28;
  else if ('ilI1|.,:;\'!'.includes(ch)) base = 0.26;
  else if ('fjrt()[]'.includes(ch)) base = 0.34;
  else if ('mwMW@%'.includes(ch)) base = 0.82;
  else if (code >= 65 && code <= 90) base = 0.66; // Uppercase A-Z
  else if (code >= 48 && code <= 57) base = 0.56; // Digits 0-9
  return isBold ? base * 1.05 : base;
}

function measureTextWidth(text, fontSize, isBold = false) {
  const clean = sanitizePdfText(text);
  let total = 0;
  for (let i = 0; i < clean.length; i++) {
    total += estimateCharWidth(clean[i], isBold) * fontSize;
  }
  return total;
}

/**
 * Wraps text into lines that fit within `maxWidthPt` at `fontSize`.
 * Handles both normal multi-word strings and single overlong tokens.
 */
function wrapTextLines(text, maxWidthPt, fontSize, isBold = false) {
  const clean = sanitizePdfText(text);
  if (!clean) return [''];
  if (measureTextWidth(clean, fontSize, isBold) <= maxWidthPt) {
    return [clean];
  }

  const words = clean.split(' ');
  const lines = [];
  let currentLine = '';

  const splitLongToken = (token) => {
    const parts = [];
    let chunk = '';
    for (let i = 0; i < token.length; i++) {
      const candidate = chunk + token[i];
      if (measureTextWidth(candidate, fontSize, isBold) > maxWidthPt && chunk.length > 0) {
        parts.push(chunk);
        chunk = token[i];
      } else {
        chunk = candidate;
      }
    }
    if (chunk) parts.push(chunk);
    return parts;
  };

  for (const word of words) {
    if (!currentLine) {
      if (measureTextWidth(word, fontSize, isBold) <= maxWidthPt) {
        currentLine = word;
      } else {
        const broken = splitLongToken(word);
        for (let i = 0; i < broken.length - 1; i++) {
          lines.push(broken[i]);
        }
        currentLine = broken[broken.length - 1] || '';
      }
    } else {
      const candidate = `${currentLine} ${word}`;
      if (measureTextWidth(candidate, fontSize, isBold) <= maxWidthPt) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        if (measureTextWidth(word, fontSize, isBold) <= maxWidthPt) {
          currentLine = word;
        } else {
          const broken = splitLongToken(word);
          for (let i = 0; i < broken.length - 1; i++) {
            lines.push(broken[i]);
          }
          currentLine = broken[broken.length - 1] || '';
        }
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function formatNumberDisplay(val) {
  if (val === null || val === undefined || val === '') return '--';
  const num = Number(val);
  if (!Number.isFinite(num)) return '--';
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
}

function formatPctDisplay(val, available = true) {
  if (!available || val === null || val === undefined || val === '') return '--';
  const num = Number(val);
  if (!Number.isFinite(num)) return '--';
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function formatGenerationDate(dateInput) {
  try {
    const dt = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const year = dt.getUTCFullYear();
    const month = months[dt.getUTCMonth()];
    const day = dt.getUTCDate();
    return `${month} ${day}, ${year}`;
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Low-level PDF page drawing helper (top-down coordinate system: y=0 at top of page).
 */
class PdfPageCanvas {
  constructor() {
    this.ops = [];
  }

  toPdfY(topY) {
    return Number((A4_HEIGHT - topY).toFixed(2));
  }

  setFillGray(gray) {
    const g = Math.max(0, Math.min(1, Number(gray))).toFixed(3);
    this.ops.push(`${g} g`);
  }

  setStrokeGray(gray) {
    const g = Math.max(0, Math.min(1, Number(gray))).toFixed(3);
    this.ops.push(`${g} G`);
  }

  setLineWidth(width) {
    this.ops.push(`${Number(width).toFixed(2)} w`);
  }

  drawRect(x, topY, width, height, { fillGray = null, strokeGray = null, lineWidth = 0.75 } = {}) {
    const pdfY = Number((A4_HEIGHT - topY - height).toFixed(2));
    const xStr = Number(x).toFixed(2);
    const wStr = Number(width).toFixed(2);
    const hStr = Number(height).toFixed(2);

    if (fillGray !== null && strokeGray !== null) {
      this.setFillGray(fillGray);
      this.setStrokeGray(strokeGray);
      this.setLineWidth(lineWidth);
      this.ops.push(`${xStr} ${pdfY} ${wStr} ${hStr} re B`);
    } else if (fillGray !== null) {
      this.setFillGray(fillGray);
      this.ops.push(`${xStr} ${pdfY} ${wStr} ${hStr} re f`);
    } else if (strokeGray !== null) {
      this.setStrokeGray(strokeGray);
      this.setLineWidth(lineWidth);
      this.ops.push(`${xStr} ${pdfY} ${wStr} ${hStr} re S`);
    }
  }

  drawLine(x1, topY1, x2, topY2, { strokeGray = 0.75, lineWidth = 0.6 } = {}) {
    this.setStrokeGray(strokeGray);
    this.setLineWidth(lineWidth);
    this.ops.push(
      `${Number(x1).toFixed(2)} ${this.toPdfY(topY1)} m ${Number(x2).toFixed(2)} ${this.toPdfY(topY2)} l S`
    );
  }

  drawText(text, x, baselineTopY, { fontSize = 9.5, bold = false, gray = 0.08, align = 'left', maxWidth = null } = {}) {
    const clean = sanitizePdfText(text);
    if (!clean) return;

    let drawX = Number(x);
    if (align === 'center' && maxWidth !== null) {
      const w = measureTextWidth(clean, fontSize, bold);
      drawX = x + Math.max(0, (maxWidth - w) / 2);
    } else if (align === 'right' && maxWidth !== null) {
      const w = measureTextWidth(clean, fontSize, bold);
      drawX = x + Math.max(0, maxWidth - w);
    }

    const fontRef = bold ? '/F2' : '/F1';
    const pdfY = this.toPdfY(baselineTopY);
    this.setFillGray(gray);
    this.ops.push(
      `BT ${fontRef} ${Number(fontSize).toFixed(2)} Tf ${drawX.toFixed(2)} ${pdfY} Td (${escapePdfLiteral(clean)}) Tj ET`
    );
  }

  getContentStream() {
    return this.ops.join('\n') + '\n';
  }
}

/**
 * Compiles an array of PdfPageCanvas instances into a complete binary PDF 1.4 Buffer.
 */
function buildPdfDocumentBuffer(pages) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length; // 1-based object ID
  };

  // Object 1: Catalog (placeholder updated below)
  const catalogObjId = addObject('');
  // Object 2: Pages root (placeholder updated below)
  const pagesRootObjId = addObject('');
  // Object 3: Font /F1 (Helvetica)
  const fontRegularId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  // Object 4: Font /F2 (Helvetica-Bold)
  const fontBoldId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  const pageObjectIds = [];

  for (const pageCanvas of pages) {
    const streamContent = pageCanvas.getContentStream();
    const streamByteLength = Buffer.byteLength(streamContent, 'utf8');
    const contentObjId = addObject(
      `<< /Length ${streamByteLength} >>\nstream\n${streamContent}endstream`
    );

    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesRootObjId} 0 R /MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> ` +
      `/Contents ${contentObjId} 0 R >>`
    );
    pageObjectIds.push(pageObjId);
  }

  objects[catalogObjId - 1] = `<< /Type /Catalog /Pages ${pagesRootObjId} 0 R >>`;
  objects[pagesRootObjId - 1] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`;

  const chunks = [];
  let offset = 0;
  const pushStr = (str) => {
    const buf = Buffer.from(str, 'utf8');
    chunks.push(buf);
    offset += buf.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const xrefOffsets = [0]; // index 0 is free object
  for (let i = 0; i < objects.length; i++) {
    xrefOffsets.push(offset);
    pushStr(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }

  const xrefStart = offset;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    const padded = String(xrefOffsets[i]).padStart(10, '0');
    pushStr(`${padded} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return Buffer.concat(chunks);
}

/**
 * Generates an A4 portrait PDF Buffer for a single semester's published academic results.
 *
 * @param {object} params
 * @param {object} params.student - { studentId, rollNumber, name, department, cohort }
 * @param {object} params.semesterData - { semesterNo, semesterLabel, summary, subjects }
 * @param {string} [params.generatedAt] - ISO timestamp
 * @returns {Buffer} Valid PDF binary buffer
 */
function generateStudentReportCardPdf({ student, semesterData, generatedAt = null }) {
  if (!student || !student.studentId) {
    throw new Error('Student identity is required to generate a report card.');
  }
  if (!semesterData || !semesterData.semesterNo) {
    throw new Error('Semester result data is required to generate a report card.');
  }

  const generationDateStr = formatGenerationDate(generatedAt);
  const semesterLabel = semesterData.semesterLabel || `Semester ${semesterData.semesterNo}`;
  const subjects = Array.isArray(semesterData.subjects) ? semesterData.subjects : [];

  // Recompute / verify authoritative summary strictly from published exam rows
  let publishedSubjectsCount = 0;
  let publishedExamsCount = 0;
  let totalObtained = 0;
  let totalMax = 0;

  const tableRows = [];

  for (const subj of subjects) {
    const subjPublishedExams = (subj.exams || []).filter(
      (e) => e && e.status === 'published' && !e.isMissing && e.obtainedMarks !== null && e.obtainedMarks !== undefined
    );
    if (subjPublishedExams.length > 0) {
      publishedSubjectsCount += 1;
    }

    const byType = new Map();
    for (const ex of subjPublishedExams) {
      byType.set(ex.examType, ex);
      publishedExamsCount += 1;
      totalObtained += Number(ex.obtainedMarks);
      totalMax += Number(ex.maxMarks);
    }

    for (let idx = 0; idx < EXAM_TYPES.length; idx++) {
      const examType = EXAM_TYPES[idx];
      const pubExam = byType.get(examType) || null;
      tableRows.push({
        isFirstExamOfSubject: idx === 0,
        isLastExamOfSubject: idx === EXAM_TYPES.length - 1,
        subjectCode: subj.code || subj.subjectId || '--',
        subjectName: subj.name || subj.subjectId || 'Subject',
        examType,
        isPublished: Boolean(pubExam),
        obtainedMarks: pubExam ? formatNumberDisplay(pubExam.obtainedMarks) : '--',
        maxMarks: pubExam ? formatNumberDisplay(pubExam.maxMarks) : '--',
        percentage: pubExam ? formatPctDisplay(pubExam.percentage, pubExam.percentageAvailable) : '--',
        statusText: pubExam ? 'Published' : 'Not Published'
      });
    }
  }

  const totalObtainedRounded = Math.round(totalObtained * 100) / 100;
  const totalMaxRounded = Math.round(totalMax * 100) / 100;
  const overallPercentage = totalMaxRounded > 0
    ? Math.round(((totalObtainedRounded / totalMaxRounded) * 100) * 100) / 100
    : null;

  // Column layout across 515.28 pt content width:
  // [Code: 56pt] [Subject Name: 175pt] [Exam Type: 92pt] [Obtained: 48pt] [Max: 44pt] [Pct: 44pt] [Status: 56.28pt]
  const cols = [
    { key: 'code', label: 'CODE', x: MARGIN_LEFT, width: 56, align: 'left' },
    { key: 'subject', label: 'SUBJECT NAME', x: MARGIN_LEFT + 56, width: 175, align: 'left' },
    { key: 'exam', label: 'EXAMINATION', x: MARGIN_LEFT + 231, width: 92, align: 'left' },
    { key: 'obtained', label: 'OBTAINED', x: MARGIN_LEFT + 323, width: 48, align: 'right' },
    { key: 'max', label: 'MAX', x: MARGIN_LEFT + 371, width: 44, align: 'right' },
    { key: 'pct', label: 'PERCENT', x: MARGIN_LEFT + 415, width: 44, align: 'right' },
    { key: 'status', label: 'STATUS', x: MARGIN_LEFT + 459, width: 56.28, align: 'right' }
  ];

  const pages = [];
  let currentPage = new PdfPageCanvas();
  pages.push(currentPage);

  const drawInstitutionHeader = (canvas, isContinuation = false) => {
    let y = MARGIN_TOP;

    // Top dark institutional banner
    canvas.drawRect(MARGIN_LEFT, y, CONTENT_WIDTH, isContinuation ? 48 : 66, {
      fillGray: 0.07,
      strokeGray: 0.07,
      lineWidth: 1
    });

    canvas.drawText('GANDAKI UNIVERSITY', MARGIN_LEFT + 16, y + 22, {
      fontSize: isContinuation ? 12 : 14,
      bold: true,
      gray: 1.0
    });

    canvas.drawText('SEMESTER LIBRARY', MARGIN_LEFT + 16, y + 37, {
      fontSize: 8.5,
      bold: true,
      gray: 0.82
    });

    if (!isContinuation) {
      canvas.drawText('ACADEMIC RESULT REPORT', MARGIN_LEFT + 16, y + 54, {
        fontSize: 11,
        bold: true,
        gray: 1.0
      });
    }

    canvas.drawText(semesterLabel.toUpperCase(), MARGIN_LEFT + CONTENT_WIDTH - 146, y + 24, {
      fontSize: 10,
      bold: true,
      gray: 1.0,
      align: 'right',
      maxWidth: 130
    });

    canvas.drawText(`Generated: ${generationDateStr}`, MARGIN_LEFT + CONTENT_WIDTH - 186, y + 40, {
      fontSize: 8,
      bold: false,
      gray: 0.84,
      align: 'right',
      maxWidth: 170
    });

    return y + (isContinuation ? 58 : 78);
  };

  const drawStudentMetadataAndSummary = (canvas, startY) => {
    let y = startY;

    // Student Metadata Box
    const metaHeight = 54;
    canvas.drawRect(MARGIN_LEFT, y, CONTENT_WIDTH, metaHeight, {
      fillGray: 0.97,
      strokeGray: 0.80,
      lineWidth: 0.75
    });

    const leftColX = MARGIN_LEFT + 14;
    const rightColX = MARGIN_LEFT + 280;

    canvas.drawText('STUDENT NAME:', leftColX, y + 18, { fontSize: 8, bold: true, gray: 0.38 });
    canvas.drawText(student.name || '--', leftColX + 82, y + 18, { fontSize: 9.5, bold: true, gray: 0.06 });

    canvas.drawText('STUDENT ID:', leftColX, y + 34, { fontSize: 8, bold: true, gray: 0.38 });
    canvas.drawText(student.rollNumber || student.studentId || '--', leftColX + 82, y + 34, {
      fontSize: 9.5,
      bold: true,
      gray: 0.06
    });

    canvas.drawText('PROGRAMME / DEPT:', leftColX, y + 47, { fontSize: 7.5, bold: true, gray: 0.38 });
    const deptCohortLabel = [
      student.department || 'BIT',
      student.cohort && student.cohort.displayName ? `${student.cohort.displayName} Cohort` : null
    ]
      .filter(Boolean)
      .join(' | ');
    canvas.drawText(deptCohortLabel, leftColX + 82, y + 47, { fontSize: 8.5, bold: false, gray: 0.15 });

    canvas.drawText('SEMESTER:', rightColX, y + 18, { fontSize: 8, bold: true, gray: 0.38 });
    canvas.drawText(semesterLabel, rightColX + 86, y + 18, { fontSize: 9.5, bold: true, gray: 0.06 });

    canvas.drawText('REPORT DATE:', rightColX, y + 34, { fontSize: 8, bold: true, gray: 0.38 });
    canvas.drawText(generationDateStr, rightColX + 86, y + 34, { fontSize: 9, bold: false, gray: 0.12 });

    canvas.drawText('RECORD SCOPE:', rightColX, y + 47, { fontSize: 7.5, bold: true, gray: 0.38 });
    canvas.drawText('Published Examination Results Only', rightColX + 86, y + 47, {
      fontSize: 8.5,
      bold: false,
      gray: 0.15
    });

    y += metaHeight + 12;

    // Academic Summary Strip (4 tiles)
    const tileGap = 8;
    const tileWidth = (CONTENT_WIDTH - tileGap * 3) / 4;
    const tileHeight = 44;

    const summaryTiles = [
      {
        label: 'SUBJECTS WITH RESULTS',
        value: String(publishedSubjectsCount)
      },
      {
        label: 'PUBLISHED EXAMS',
        value: String(publishedExamsCount)
      },
      {
        label: 'AGGREGATED MARKS',
        value: publishedExamsCount > 0 ? `${formatNumberDisplay(totalObtainedRounded)} / ${formatNumberDisplay(totalMaxRounded)}` : '--'
      },
      {
        label: 'OVERALL PERCENTAGE',
        value: formatPctDisplay(overallPercentage, overallPercentage !== null)
      }
    ];

    summaryTiles.forEach((tile, idx) => {
      const tx = MARGIN_LEFT + idx * (tileWidth + tileGap);
      canvas.drawRect(tx, y, tileWidth, tileHeight, {
        fillGray: 0.985,
        strokeGray: 0.82,
        lineWidth: 0.65
      });
      canvas.drawText(tile.label, tx + 10, y + 15, {
        fontSize: 7,
        bold: true,
        gray: 0.42
      });
      canvas.drawText(tile.value, tx + 10, y + 33, {
        fontSize: 12,
        bold: true,
        gray: 0.06
      });
    });

    return y + tileHeight + 16;
  };

  const drawTableHeader = (canvas, topY) => {
    const headerHeight = 22;
    canvas.drawRect(MARGIN_LEFT, topY, CONTENT_WIDTH, headerHeight, {
      fillGray: 0.14,
      strokeGray: 0.14,
      lineWidth: 0.75
    });

    for (const col of cols) {
      const padX = col.align === 'left' ? col.x + 6 : col.x;
      const availW = col.align === 'left' ? col.width - 8 : col.width - 6;
      canvas.drawText(col.label, padX, topY + 14.5, {
        fontSize: 7.5,
        bold: true,
        gray: 1.0,
        align: col.align,
        maxWidth: availW
      });
    }

    return topY + headerHeight;
  };

  let cursorY = drawInstitutionHeader(currentPage, false);
  cursorY = drawStudentMetadataAndSummary(currentPage, cursorY);

  // Section heading
  currentPage.drawText(`SUBJECT-WISE EXAMINATION BREAKDOWN (${semesterLabel.toUpperCase()})`, MARGIN_LEFT, cursorY, {
    fontSize: 9,
    bold: true,
    gray: 0.15
  });
  cursorY += 7;
  cursorY = drawTableHeader(currentPage, cursorY);

  const maxTableBottomY = A4_HEIGHT - MARGIN_BOTTOM - 68;

  for (let i = 0; i < tableRows.length; i++) {
    const row = tableRows[i];
    const subjectLines = row.isFirstExamOfSubject
      ? wrapTextLines(row.subjectName, cols[1].width - 12, 8.5, true)
      : [''];
    const lineCount = Math.max(1, subjectLines.length);
    const rowHeight = Math.max(19, 12 + lineCount * 10);

    if (cursorY + rowHeight > maxTableBottomY) {
      currentPage = new PdfPageCanvas();
      pages.push(currentPage);
      cursorY = drawInstitutionHeader(currentPage, true);
      cursorY = drawTableHeader(currentPage, cursorY);
    }

    const rowFill = !row.isPublished ? 0.99 : row.isFirstExamOfSubject ? 0.965 : 1.0;
    currentPage.drawRect(MARGIN_LEFT, cursorY, CONTENT_WIDTH, rowHeight, {
      fillGray: rowFill,
      strokeGray: 0.86,
      lineWidth: 0.45
    });

    const textBaseline = cursorY + 13;

    if (row.isFirstExamOfSubject) {
      currentPage.drawText(row.subjectCode, cols[0].x + 6, textBaseline, {
        fontSize: 8.5,
        bold: true,
        gray: 0.08
      });

      subjectLines.forEach((lineText, lineIdx) => {
        currentPage.drawText(lineText, cols[1].x + 6, textBaseline + lineIdx * 10, {
          fontSize: 8.5,
          bold: true,
          gray: 0.08
        });
      });
    }

    currentPage.drawText(row.examType, cols[2].x + 6, textBaseline, {
      fontSize: 8.5,
      bold: false,
      gray: row.isPublished ? 0.1 : 0.45
    });

    currentPage.drawText(row.obtainedMarks, cols[3].x, textBaseline, {
      fontSize: 8.5,
      bold: row.isPublished,
      gray: row.isPublished ? 0.08 : 0.5,
      align: 'right',
      maxWidth: cols[3].width - 6
    });

    currentPage.drawText(row.maxMarks, cols[4].x, textBaseline, {
      fontSize: 8.5,
      bold: false,
      gray: row.isPublished ? 0.15 : 0.5,
      align: 'right',
      maxWidth: cols[4].width - 6
    });

    currentPage.drawText(row.percentage, cols[5].x, textBaseline, {
      fontSize: 8.5,
      bold: row.isPublished,
      gray: row.isPublished ? 0.08 : 0.5,
      align: 'right',
      maxWidth: cols[5].width - 6
    });

    currentPage.drawText(row.statusText, cols[6].x, textBaseline, {
      fontSize: 7.5,
      bold: row.isPublished,
      gray: row.isPublished ? 0.1 : 0.48,
      align: 'right',
      maxWidth: cols[6].width - 6
    });

    cursorY += rowHeight;

    if (row.isLastExamOfSubject) {
      currentPage.drawLine(MARGIN_LEFT, cursorY, MARGIN_LEFT + CONTENT_WIDTH, cursorY, {
        strokeGray: 0.55,
        lineWidth: 0.8
      });
    }
  }

  // Summary total row at bottom of table
  const totalRowHeight = 22;
  if (cursorY + totalRowHeight > maxTableBottomY) {
    currentPage = new PdfPageCanvas();
    pages.push(currentPage);
    cursorY = drawInstitutionHeader(currentPage, true);
  }

  currentPage.drawRect(MARGIN_LEFT, cursorY, CONTENT_WIDTH, totalRowHeight, {
    fillGray: 0.92,
    strokeGray: 0.45,
    lineWidth: 0.75
  });

  currentPage.drawText(
    `SEMESTER PUBLISHED TOTAL (${publishedExamsCount} ${publishedExamsCount === 1 ? 'Exam' : 'Exams'} across ${publishedSubjectsCount} ${publishedSubjectsCount === 1 ? 'Subject' : 'Subjects'})`,
    cols[0].x + 6,
    cursorY + 14.5,
    { fontSize: 8.5, bold: true, gray: 0.06 }
  );

  currentPage.drawText(formatNumberDisplay(totalObtainedRounded), cols[3].x, cursorY + 14.5, {
    fontSize: 9,
    bold: true,
    gray: 0.06,
    align: 'right',
    maxWidth: cols[3].width - 6
  });

  currentPage.drawText(formatNumberDisplay(totalMaxRounded), cols[4].x, cursorY + 14.5, {
    fontSize: 9,
    bold: true,
    gray: 0.06,
    align: 'right',
    maxWidth: cols[4].width - 6
  });

  currentPage.drawText(formatPctDisplay(overallPercentage, overallPercentage !== null), cols[5].x, cursorY + 14.5, {
    fontSize: 9,
    bold: true,
    gray: 0.06,
    align: 'right',
    maxWidth: cols[5].width - 6
  });

  cursorY += totalRowHeight + 14;

  // Explanatory & Exclusion Notes Box
  const noteBoxHeight = 46;
  if (cursorY + noteBoxHeight > A4_HEIGHT - MARGIN_BOTTOM) {
    currentPage = new PdfPageCanvas();
    pages.push(currentPage);
    cursorY = drawInstitutionHeader(currentPage, true) + 10;
  }

  currentPage.drawRect(MARGIN_LEFT, cursorY, CONTENT_WIDTH, noteBoxHeight, {
    fillGray: 0.975,
    strokeGray: 0.82,
    lineWidth: 0.6
  });

  currentPage.drawText(
    'IMPORTANT ACADEMIC RESULT NOTES:',
    MARGIN_LEFT + 10,
    cursorY + 13,
    { fontSize: 7.5, bold: true, gray: 0.2 }
  );
  currentPage.drawText(
    '1. Unpublished or draft examination marks are excluded from this report. Only published marks are included in totals and percentages.',
    MARGIN_LEFT + 10,
    cursorY + 25,
    { fontSize: 7.5, bold: false, gray: 0.28 }
  );
  currentPage.drawText(
    '2. This document is an informational academic result report generated from Semester Library and is not an official university transcript.',
    MARGIN_LEFT + 10,
    cursorY + 37,
    { fontSize: 7.5, bold: false, gray: 0.28 }
  );

  // Add footer with page numbers on every page
  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    const footerY = A4_HEIGHT - 24;
    p.drawLine(MARGIN_LEFT, footerY - 10, MARGIN_LEFT + CONTENT_WIDTH, footerY - 10, {
      strokeGray: 0.82,
      lineWidth: 0.5
    });
    p.drawText(
      `GANDAKI UNIVERSITY | SEMESTER LIBRARY | ACADEMIC RESULT REPORT (${semesterLabel.toUpperCase()})`,
      MARGIN_LEFT,
      footerY,
      { fontSize: 7.5, bold: false, gray: 0.45 }
    );
    p.drawText(
      `Page ${idx + 1} of ${totalPages}`,
      MARGIN_LEFT + CONTENT_WIDTH - 80,
      footerY,
      { fontSize: 7.5, bold: false, gray: 0.45, align: 'right', maxWidth: 80 }
    );
  });

  return buildPdfDocumentBuffer(pages);
}

module.exports = {
  A4_WIDTH,
  A4_HEIGHT,
  wrapTextLines,
  generateStudentReportCardPdf
};
