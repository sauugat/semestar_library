'use strict';

/**
 * Semester Library — Official A4 Portrait PDF Report Card Generator
 *
 * Generates a clean, print-ready PDF 1.4 report card (A4 portrait: 595.28 x 841.89 pt)
 * for a single exam type (Mid-Term Exam, Pre-Board Exam, or Final Exam) of a student's
 * selected semester, using only published examination marks.
 *
 * Layout:
 * - Centered Gandaki University full-color emblem (JPEG XObject) + University heading
 * - Metadata box: Name, Student ID, Semester, Exam Type, Issued Date (BS)
 * - Table: S.N. | Subject | Marks | Remark (all semester subjects; '-' if unavailable)
 * - Below Table: Percentage & Rank summary cards
 * - Clean signature lines and footer
 */

const fs = require('fs');
const path = require('path');

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_LEFT = 44;
const MARGIN_RIGHT = 44;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 44;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 507.28 pt

const EXAM_TYPES = [
  'Mid-Term Exam',
  'Pre-Board Exam',
  'Final Exam'
];

let cachedLogoJpeg = null;

/**
 * Parses JPEG SOF0/SOF2 dimensions from a Buffer.
 */
function parseJpegDimensions(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const segLen = buf.readUInt16BE(offset + 2);
    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ||
      marker === 0xc3 || marker === 0xc5 || marker === 0xc6 || marker === 0xc7
    ) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (segLen < 2) break;
    offset += 2 + segLen;
  }
  return null;
}

function getGandakiLogoJpeg() {
  if (cachedLogoJpeg !== null) return cachedLogoJpeg;
  const jpgPath = path.join(__dirname, '..', 'public', 'images', 'gandaki-university-logo.jpg');
  try {
    if (fs.existsSync(jpgPath)) {
      const data = fs.readFileSync(jpgPath);
      const dims = parseJpegDimensions(data);
      if (dims && dims.width > 0 && dims.height > 0) {
        cachedLogoJpeg = { data, width: dims.width, height: dims.height };
        return cachedLogoJpeg;
      }
    }
  } catch (_) {}
  cachedLogoJpeg = false;
  return cachedLogoJpeg;
}

/**
 * Sanitizes text for PDF WinAnsi / literal string encoding.
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

function estimateCharWidth(ch, isBold = false) {
  const code = ch.charCodeAt(0);
  let base = 0.52;
  if (ch === ' ') base = 0.28;
  else if ('ilI1|.,:;\'!'.includes(ch)) base = 0.26;
  else if ('fjrt()[]'.includes(ch)) base = 0.34;
  else if ('mwMW@%'.includes(ch)) base = 0.82;
  else if (code >= 65 && code <= 90) base = 0.66;
  else if (code >= 48 && code <= 57) base = 0.56;
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

  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

function formatNumberDisplay(val) {
  if (val === null || val === undefined || val === '') return '-';
  const num = Number(val);
  if (!Number.isFinite(num)) return '-';
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
}

function formatPctDisplay(val) {
  if (val === null || val === undefined || val === '') return '-';
  const num = Number(val);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function formatFallbackDate(dateInput) {
  try {
    const dt = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
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
    this.usesLogo = false;
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

  drawImage(imageName, x, topY, width, height) {
    this.usesLogo = true;
    const pdfY = Number((A4_HEIGHT - topY - height).toFixed(2));
    this.ops.push(
      `q ${Number(width).toFixed(2)} 0 0 ${Number(height).toFixed(2)} ${Number(x).toFixed(2)} ${pdfY} cm /${imageName} Do Q`
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
 * Compiles PdfPageCanvas instances + optional JPEG logo XObject into a binary PDF 1.4 Buffer.
 */
function buildPdfDocumentBuffer(pages, logoJpeg = null) {
  const objects = []; // Each entry is a Buffer
  const addObject = (body) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8'));
    return objects.length; // 1-based object ID
  };

  const catalogObjId = addObject('');
  const pagesRootObjId = addObject('');
  const fontRegularId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const fontBoldId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  );

  let logoObjId = null;
  if (logoJpeg && logoJpeg.data && logoJpeg.width && logoJpeg.height) {
    const imgHeader = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${logoJpeg.width} /Height ${logoJpeg.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoJpeg.data.length} >>\nstream\n`,
      'utf8'
    );
    const imgFooter = Buffer.from('\nendstream', 'utf8');
    logoObjId = addObject(Buffer.concat([imgHeader, logoJpeg.data, imgFooter]));
  }

  const pageObjectIds = [];
  for (const pageCanvas of pages) {
    const streamContent = pageCanvas.getContentStream();
    const streamBuf = Buffer.from(streamContent, 'utf8');
    const contentObjId = addObject(
      Buffer.concat([
        Buffer.from(`<< /Length ${streamBuf.length} >>\nstream\n`, 'utf8'),
        streamBuf,
        Buffer.from('endstream', 'utf8')
      ])
    );

    const xObjPart = logoObjId && pageCanvas.usesLogo ? ` /XObject << /Im1 ${logoObjId} 0 R >>` : '';
    const pageObjId = addObject(
      `<< /Type /Page /Parent ${pagesRootObjId} 0 R /MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${xObjPart} >> ` +
      `/Contents ${contentObjId} 0 R >>`
    );
    pageObjectIds.push(pageObjId);
  }

  objects[catalogObjId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesRootObjId} 0 R >>`, 'utf8');
  objects[pagesRootObjId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`,
    'utf8'
  );

  const chunks = [];
  let offset = 0;
  const pushBuf = (b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(String(b), 'utf8');
    chunks.push(buf);
    offset += buf.length;
  };

  pushBuf(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary'));

  const xrefOffsets = [0];
  for (let i = 0; i < objects.length; i++) {
    xrefOffsets.push(offset);
    pushBuf(`${i + 1} 0 obj\n`);
    pushBuf(objects[i]);
    pushBuf('\nendobj\n');
  }

  const xrefStart = offset;
  pushBuf(`xref\n0 ${objects.length + 1}\n`);
  pushBuf('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    pushBuf(`${String(xrefOffsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  pushBuf(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return Buffer.concat(chunks);
}

/**
 * Generates a redesigned, official A4 Portrait PDF Report Card for a single exam type
 * (Mid-Term Exam, Pre-Board Exam, or Final Exam).
 *
 * @param {object} params
 * @param {object} params.student - { studentId, rollNumber, name, department, cohort }
 * @param {object} params.semesterData - { semesterNo, semesterLabel, subjects }
 * @param {string} [params.examType] - 'Mid-Term Exam' | 'Pre-Board Exam' | 'Final Exam'
 * @param {Array}  [params.subjectRows] - [{ code, name, marksDisplay, remarkDisplay, obtainedMarks, maxMarks, isAbsent, hasMarks }]
 * @param {number|null} [params.percentage] - Overall exam percentage
 * @param {string|number|null} [params.rank] - Student's rank in semester for this exam (or '-')
 * @param {string} [params.issuedDate] - Formatted BS or calendar issued date
 * @param {string} [params.generatedAt] - ISO timestamp fallback
 * @returns {Buffer}
 */
function generateStudentReportCardPdf({
  student,
  semesterData,
  examType = null,
  subjectRows = null,
  percentage = null,
  rank = null,
  issuedDate = null,
  generatedAt = null
}) {
  if (!student || !student.studentId) {
    throw new Error('Student identity is required to generate a report card.');
  }
  if (!semesterData || !semesterData.semesterNo) {
    throw new Error('Semester result data is required to generate a report card.');
  }

  const resolvedExamType = examType || 'Mid-Term Exam';
  const issuedDateStr = issuedDate || formatFallbackDate(generatedAt);
  const semesterLabel = semesterData.semesterLabel || `Semester ${semesterData.semesterNo}`;
  const cohortText = student.cohort && student.cohort.displayName ? ` (${student.cohort.displayName})` : '';

  // Build table rows from explicit `subjectRows` or derive from `semesterData.subjects`
  let rows = [];
  let computedObtained = 0;
  let computedMax = 0;
  let hasAnyPublished = false;

  if (Array.isArray(subjectRows) && subjectRows.length > 0) {
    rows = subjectRows.map((r, idx) => ({
      sn: idx + 1,
      subjectLabel: r.code && r.name ? `${r.code} - ${r.name}` : (r.name || r.code || 'Subject'),
      marksDisplay: r.marksDisplay !== undefined && r.marksDisplay !== null ? String(r.marksDisplay) : '-',
      remarkDisplay: r.remarkDisplay !== undefined && r.remarkDisplay !== null ? String(r.remarkDisplay) : '-'
    }));
  } else {
    const subjects = Array.isArray(semesterData.subjects) ? semesterData.subjects : [];
    rows = subjects.map((subj, idx) => {
      const pubExam = (subj.exams || []).find(
        (e) => e && e.examType === resolvedExamType && (e.status === 'published' || e.isAbsent)
      );
      if (!pubExam) {
        return {
          sn: idx + 1,
          subjectLabel: subj.code && subj.name ? `${subj.code} - ${subj.name}` : (subj.name || subj.code || 'Subject'),
          marksDisplay: '-',
          remarkDisplay: '-'
        };
      }
      hasAnyPublished = true;
      const isAbsent = Boolean(pubExam.isAbsent || pubExam.status === 'Absent');
      const mx = Number(pubExam.maxMarks || 0);
      if (isAbsent) {
        if (mx > 0) computedMax += mx;
        return {
          sn: idx + 1,
          subjectLabel: subj.code && subj.name ? `${subj.code} - ${subj.name}` : (subj.name || subj.code || 'Subject'),
          marksDisplay: 'Absent',
          remarkDisplay: 'Fail'
        };
      }
      const obt = Number(pubExam.obtainedMarks);
      if (mx > 0) {
        computedObtained += obt;
        computedMax += mx;
      }
      const pct = mx > 0 ? (obt / mx) * 100 : null;
      return {
        sn: idx + 1,
        subjectLabel: subj.code && subj.name ? `${subj.code} - ${subj.name}` : (subj.name || subj.code || 'Subject'),
        marksDisplay: formatNumberDisplay(obt),
        remarkDisplay: pct !== null ? (pct >= 45 ? 'Pass' : 'Fail') : '-'
      };
    });
  }

  const finalPercentage =
    percentage !== null && percentage !== undefined
      ? Number(percentage)
      : (hasAnyPublished && computedMax > 0
          ? Math.round(((computedObtained / computedMax) * 100) * 100) / 100
          : null);
  const pctDisplay = finalPercentage !== null && Number.isFinite(finalPercentage) ? formatPctDisplay(finalPercentage) : '-';
  const rankDisplay = rank !== null && rank !== undefined && String(rank).trim() !== '' ? String(rank) : '-';

  const logoJpeg = getGandakiLogoJpeg();

  // Table columns across CONTENT_WIDTH = 507.28 pt:
  // S.N. (46) | Subject (275.28) | Marks (90) | Remark (96)
  const cols = [
    { key: 'sn', label: 'S.N.', x: MARGIN_LEFT, width: 46, align: 'center' },
    { key: 'subject', label: 'Subject', x: MARGIN_LEFT + 46, width: 275.28, align: 'left' },
    { key: 'marks', label: 'Marks', x: MARGIN_LEFT + 321.28, width: 90, align: 'center' },
    { key: 'remark', label: 'Remark', x: MARGIN_LEFT + 411.28, width: 96, align: 'center' }
  ];

  const pages = [];
  let currentPage = new PdfPageCanvas();
  pages.push(currentPage);

  const drawPageFrame = (canvas) => {
    // Subtle classic double border frame around the report card
    canvas.drawRect(24, 24, A4_WIDTH - 48, A4_HEIGHT - 48, { strokeGray: 0.72, lineWidth: 0.9 });
    canvas.drawRect(28, 28, A4_WIDTH - 56, A4_HEIGHT - 56, { strokeGray: 0.86, lineWidth: 0.45 });
  };

  const drawHeader = (canvas, isContinuation = false) => {
    drawPageFrame(canvas);
    let y = MARGIN_TOP;

    if (!isContinuation && logoJpeg) {
      const logoSize = 54;
      const logoX = (A4_WIDTH - logoSize) / 2;
      canvas.drawImage('Im1', logoX, y, logoSize, logoSize);
      y += logoSize + 14;
    } else {
      y += 14;
    }

    canvas.drawText('GANDAKI UNIVERSITY', MARGIN_LEFT, y, {
      fontSize: isContinuation ? 14 : 17,
      bold: true,
      gray: 0.05,
      align: 'center',
      maxWidth: CONTENT_WIDTH
    });
    y += 15;

    if (!isContinuation) {
      canvas.drawText('Faculty of Science and Technology  |  Bachelor of Information Technology', MARGIN_LEFT, y, {
        fontSize: 8.5,
        bold: false,
        gray: 0.35,
        align: 'center',
        maxWidth: CONTENT_WIDTH
      });
      y += 17;
    }

    canvas.drawText('EXAMINATION REPORT CARD', MARGIN_LEFT, y, {
      fontSize: 11,
      bold: true,
      gray: 0.12,
      align: 'center',
      maxWidth: CONTENT_WIDTH
    });
    y += 8;

    // Clean horizontal divider rule
    canvas.drawLine(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y, { strokeGray: 0.25, lineWidth: 1.0 });
    return y + 14;
  };

  const drawMetadataBox = (canvas, startY) => {
    const boxH = 62;
    canvas.drawRect(MARGIN_LEFT, startY, CONTENT_WIDTH, boxH, {
      fillGray: 0.975,
      strokeGray: 0.78,
      lineWidth: 0.7
    });

    const leftX = MARGIN_LEFT + 14;
    const rightX = MARGIN_LEFT + 286;

    // Row 1
    canvas.drawText('Name:', leftX, startY + 18, { fontSize: 8.5, bold: true, gray: 0.35 });
    canvas.drawText(student.name || '-', leftX + 68, startY + 18, { fontSize: 9.5, bold: true, gray: 0.06 });

    canvas.drawText('Exam Type:', rightX, startY + 18, { fontSize: 8.5, bold: true, gray: 0.35 });
    canvas.drawText(resolvedExamType, rightX + 68, startY + 18, { fontSize: 9.5, bold: true, gray: 0.06 });

    // Row 2
    canvas.drawText('Student ID:', leftX, startY + 35, { fontSize: 8.5, bold: true, gray: 0.35 });
    canvas.drawText(student.rollNumber || student.studentId || '-', leftX + 68, startY + 35, { fontSize: 9.5, bold: false, gray: 0.1 });

    canvas.drawText('Issued Date:', rightX, startY + 35, { fontSize: 8.5, bold: true, gray: 0.35 });
    canvas.drawText(issuedDateStr, rightX + 68, startY + 35, { fontSize: 9.5, bold: false, gray: 0.1 });

    // Row 3
    canvas.drawText('Semester:', leftX, startY + 52, { fontSize: 8.5, bold: true, gray: 0.35 });
    canvas.drawText(`${semesterLabel}${cohortText}`, leftX + 68, startY + 52, { fontSize: 9.5, bold: false, gray: 0.1 });

    return startY + boxH + 18;
  };

  const drawTableHeader = (canvas, topY) => {
    const headerH = 26;
    canvas.drawRect(MARGIN_LEFT, topY, CONTENT_WIDTH, headerH, {
      fillGray: 0.92,
      strokeGray: 0.25,
      lineWidth: 0.8
    });

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (i > 0) {
        canvas.drawLine(col.x, topY, col.x, topY + headerH, { strokeGray: 0.25, lineWidth: 0.6 });
      }
      const padX = col.align === 'left' ? col.x + 10 : col.x;
      const availW = col.align === 'left' ? col.width - 14 : col.width;
      canvas.drawText(col.label, padX, topY + 16.5, {
        fontSize: 9.5,
        bold: true,
        gray: 0.06,
        align: col.align,
        maxWidth: availW
      });
    }

    return topY + headerH;
  };

  let cursorY = drawHeader(currentPage, false);
  cursorY = drawMetadataBox(currentPage, cursorY);
  cursorY = drawTableHeader(currentPage, cursorY);

  const maxTableBottomY = A4_HEIGHT - MARGIN_BOTTOM - 145;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const subjectLines = wrapTextLines(row.subjectLabel, cols[1].width - 18, 9.5, false);
    const lineCount = Math.max(1, subjectLines.length);
    const rowH = Math.max(24, 12 + lineCount * 12);

    if (cursorY + rowH > maxTableBottomY) {
      currentPage = new PdfPageCanvas();
      pages.push(currentPage);
      cursorY = drawHeader(currentPage, true);
      cursorY = drawTableHeader(currentPage, cursorY);
    }

    const rowFill = i % 2 === 1 ? 0.985 : 1.0;
    currentPage.drawRect(MARGIN_LEFT, cursorY, CONTENT_WIDTH, rowH, {
      fillGray: rowFill,
      strokeGray: 0.35,
      lineWidth: 0.55
    });

    for (let c = 1; c < cols.length; c++) {
      currentPage.drawLine(cols[c].x, cursorY, cols[c].x, cursorY + rowH, {
        strokeGray: 0.35,
        lineWidth: 0.55
      });
    }

    const firstBaseline = cursorY + 15.5;
    currentPage.drawText(String(row.sn), cols[0].x, firstBaseline, {
      fontSize: 9.5,
      bold: false,
      gray: 0.12,
      align: 'center',
      maxWidth: cols[0].width
    });

    subjectLines.forEach((lineText, lIdx) => {
      currentPage.drawText(lineText, cols[1].x + 10, firstBaseline + lIdx * 12, {
        fontSize: 9.5,
        bold: false,
        gray: 0.08
      });
    });

    currentPage.drawText(row.marksDisplay, cols[2].x, firstBaseline, {
      fontSize: 9.5,
      bold: false,
      gray: row.marksDisplay === '-' ? 0.45 : 0.08,
      align: 'center',
      maxWidth: cols[2].width
    });

    currentPage.drawText(row.remarkDisplay, cols[3].x, firstBaseline, {
      fontSize: 9.5,
      bold: false,
      gray: row.remarkDisplay === '-' ? 0.45 : 0.08,
      align: 'center',
      maxWidth: cols[3].width
    });

    cursorY += rowH;
  }

  // Below-table Summary Box: Percentage & Rank
  cursorY += 16;
  const summaryBoxH = 48;
  if (cursorY + summaryBoxH + 85 > A4_HEIGHT - MARGIN_BOTTOM) {
    currentPage = new PdfPageCanvas();
    pages.push(currentPage);
    cursorY = drawHeader(currentPage, true) + 10;
  }

  const cardGap = 14;
  const cardW = (CONTENT_WIDTH - cardGap) / 2;

  // Percentage card
  currentPage.drawRect(MARGIN_LEFT, cursorY, cardW, summaryBoxH, {
    fillGray: 0.975,
    strokeGray: 0.65,
    lineWidth: 0.75
  });
  currentPage.drawText('PERCENTAGE', MARGIN_LEFT + 14, cursorY + 17, {
    fontSize: 8,
    bold: true,
    gray: 0.42
  });
  currentPage.drawText(pctDisplay, MARGIN_LEFT + 14, cursorY + 37, {
    fontSize: 15,
    bold: true,
    gray: 0.06
  });

  // Rank card
  const rankCardX = MARGIN_LEFT + cardW + cardGap;
  currentPage.drawRect(rankCardX, cursorY, cardW, summaryBoxH, {
    fillGray: 0.975,
    strokeGray: 0.65,
    lineWidth: 0.75
  });
  currentPage.drawText('RANK', rankCardX + 14, cursorY + 17, {
    fontSize: 8,
    bold: true,
    gray: 0.42
  });
  currentPage.drawText(rankDisplay, rankCardX + 14, cursorY + 37, {
    fontSize: 15,
    bold: true,
    gray: 0.06
  });

  // Signatures near bottom of final page
  const sigY = Math.min(A4_HEIGHT - 86, Math.max(cursorY + summaryBoxH + 62, A4_HEIGHT - 102));
  currentPage.drawLine(MARGIN_LEFT + 12, sigY, MARGIN_LEFT + 172, sigY, { strokeGray: 0.25, lineWidth: 0.75 });
  currentPage.drawText('Prepared By / Class Teacher', MARGIN_LEFT + 12, sigY + 14, {
    fontSize: 8.5,
    bold: true,
    gray: 0.25,
    align: 'center',
    maxWidth: 160
  });

  const rightSigX = MARGIN_LEFT + CONTENT_WIDTH - 172;
  currentPage.drawLine(rightSigX, sigY, rightSigX + 160, sigY, { strokeGray: 0.25, lineWidth: 0.75 });
  currentPage.drawText('Controller of Examinations', rightSigX, sigY + 14, {
    fontSize: 8.5,
    bold: true,
    gray: 0.25,
    align: 'center',
    maxWidth: 160
  });

  // Page footer on every page
  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    const footerY = A4_HEIGHT - 40;
    p.drawLine(MARGIN_LEFT, footerY - 10, MARGIN_LEFT + CONTENT_WIDTH, footerY - 10, {
      strokeGray: 0.84,
      lineWidth: 0.5
    });
    p.drawText(
      `Gandaki University  |  ${semesterLabel}  |  ${resolvedExamType}  |  Published results only`,
      MARGIN_LEFT,
      footerY,
      { fontSize: 7.5, bold: false, gray: 0.48 }
    );
    p.drawText(
      `Page ${idx + 1} of ${totalPages}`,
      MARGIN_LEFT + CONTENT_WIDTH - 70,
      footerY,
      { fontSize: 7.5, bold: false, gray: 0.48, align: 'right', maxWidth: 70 }
    );
  });

  return buildPdfDocumentBuffer(pages, logoJpeg || null);
}

module.exports = {
  A4_WIDTH,
  A4_HEIGHT,
  wrapTextLines,
  generateStudentReportCardPdf
};
