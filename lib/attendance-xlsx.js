'use strict';

const zlib = require('zlib');
const crypto = require('crypto');

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SHEET_NAME_LENGTH = 31;

// Precomputed CRC32 lookup table for deterministic ZIP archive generation
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Deterministically packages an array of { name, data } entries into a valid ZIP buffer.
 * Uses fixed DOS timestamp (2026-01-01 00:00:00) so identical workbook data produces
 * byte-for-byte deterministic XLSX buffers and SHA-256 digests.
 */
function buildDeterministicZip(entries) {
  const localFileHeaders = [];
  const centralDirHeaders = [];
  let offset = 0;

  // Fixed DOS time (00:00:00) and DOS date (2026-01-01) for byte-for-byte determinism
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name), 'utf8');
    const uncompressedBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(String(entry.data), 'utf8');
    const compressedBuf = zlib.deflateRawSync(uncompressedBuf, { level: 6 });
    const crc = crc32(uncompressedBuf);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // General purpose bit flag (UTF-8 filenames)
    localHeader.writeUInt16LE(8, 8);          // Compression method: Deflate (8)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(uncompressedBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuf.copy(localHeader, 30);

    localFileHeaders.push(localHeader, compressedBuf);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8);     // General purpose bit flag (UTF-8)
    centralHeader.writeUInt16LE(8, 10);         // Compression method: Deflate (8)
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(uncompressedBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number start
    centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);         // External file attributes
    centralHeader.writeUInt32LE(offset, 42);    // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralDirHeaders.push(centralHeader);
    offset += localHeader.length + compressedBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralDirHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);            // End of central directory signature
  eocd.writeUInt16LE(0, 4);                     // Number of this disk
  eocd.writeUInt16LE(0, 6);                     // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8);        // Number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10);       // Total number of central directory records
  eocd.writeUInt32LE(centralDirBuf.length, 12); // Size of central directory
  eocd.writeUInt32LE(offset, 16);               // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                    // Comment length

  return Buffer.concat([...localFileHeaders, centralDirBuf, eocd]);
}

/**
 * Strips XML-illegal control characters and escapes XML special characters.
 */
function escapeXml(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Neutralizes spreadsheet formula injection in user-controlled or external string cells.
 * Any string beginning with =, +, -, @, tab, CR, LF (or leading whitespace followed by one
 * of those characters) is prefixed with a literal single quote (').
 */
function sanitizeFormulaCellText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (!str) return '';
  if (/^[=+\-@]/.test(str) || /^[\t\r\n]/.test(str) || /^\s+[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Sanitizes an Excel worksheet name:
 * - Replaces invalid characters (\ / * ? : [ ] and control chars)
 * - Strips leading/trailing apostrophes and whitespace
 * - Enforces the 31-character limit
 * - Deduplicates case-insensitively within usedNamesSet by appending _2, _3, etc.
 */
function sanitizeWorksheetName(rawName, usedNamesSet = new Set()) {
  let cleaned = String(rawName || '')
    .replace(/[\u0000-\u001F\\/*?:[\]]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();

  if (!cleaned || cleaned.toLowerCase() === 'history') {
    cleaned = 'Sheet';
  }

  const base = cleaned.slice(0, MAX_SHEET_NAME_LENGTH).replace(/^'+|'+$/g, '').trim() || 'Sheet';
  let candidate = base;
  let counter = 2;

  while (usedNamesSet.has(candidate.toLowerCase())) {
    const suffix = `_${counter}`;
    const maxBaseLen = Math.max(1, MAX_SHEET_NAME_LENGTH - suffix.length);
    const trimmedBase = base.slice(0, maxBaseLen).replace(/^'+|'+$/g, '').trim() || 'S';
    candidate = `${trimmedBase}${suffix}`;
    counter += 1;
  }

  usedNamesSet.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Converts a 0-based column index into an Excel column letter (0 -> A, 25 -> Z, 26 -> AA).
 */
function columnIndexToLetter(colIdx) {
  let n = colIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Builds an OpenXML worksheet XML string from rows of cell values/objects.
 * Cell styles:
 *   0 = Default body cell
 *   1 = Bold title/section header
 *   2 = Table column header (dark navy fill, bold white text)
 *   3 = Numeric / percentage cell
 */
function buildWorksheetXml({ rows = [], columnWidths = [], freezeRows = 0 }) {
  const colsXmlParts = [];
  if (Array.isArray(columnWidths) && columnWidths.length > 0) {
    for (let i = 0; i < columnWidths.length; i++) {
      const w = Number(columnWidths[i]) || 14;
      colsXmlParts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
    }
  }
  const colsXml = colsXmlParts.length > 0 ? `<cols>${colsXmlParts.join('')}</cols>` : '';

  let maxCols = 1;
  for (const r of rows) {
    const cArr = Array.isArray(r) ? r : (r && Array.isArray(r.cells) ? r.cells : []);
    if (cArr.length > maxCols) maxCols = cArr.length;
  }
  const maxRows = Math.max(1, rows.length);
  const dimensionXml = `<dimension ref="A1:${columnIndexToLetter(maxCols - 1)}${maxRows}"/>`;

  const sheetViewsXml = freezeRows > 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const rowXmlParts = [];
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const cells = Array.isArray(row) ? row : (row && Array.isArray(row.cells) ? row.cells : []);
    const defaultStyle = row && !Array.isArray(row) && typeof row.style === 'number' ? row.style : 0;
    const rowNum = rIdx + 1;
    const cellParts = [];

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const rawCell = cells[cIdx];
      const cellRef = `${columnIndexToLetter(cIdx)}${rowNum}`;
      const isObj = rawCell !== null && typeof rawCell === 'object' && !Array.isArray(rawCell);
      const rawValue = isObj ? rawCell.value : rawCell;
      const styleId = isObj && typeof rawCell.style === 'number' ? rawCell.style : defaultStyle;

      if (rawValue === null || rawValue === undefined || rawValue === '') {
        if (styleId > 0) {
          cellParts.push(`<c r="${cellRef}" s="${styleId}"/>`);
        }
        continue;
      }

      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        cellParts.push(`<c r="${cellRef}" s="${styleId}" t="n"><v>${rawValue}</v></c>`);
      } else if (typeof rawValue === 'boolean') {
        cellParts.push(`<c r="${cellRef}" s="${styleId}" t="b"><v>${rawValue ? 1 : 0}</v></c>`);
      } else {
        const safeText = sanitizeFormulaCellText(String(rawValue));
        const escapedText = escapeXml(safeText);
        cellParts.push(
          `<c r="${cellRef}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapedText}</t></is></c>`
        );
      }
    }

    rowXmlParts.push(`<row r="${rowNum}">${cellParts.join('')}</row>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    dimensionXml,
    sheetViewsXml,
    colsXml,
    `<sheetData>${rowXmlParts.join('')}</sheetData>`,
    '</worksheet>'
  ].join('');
}

/**
 * Builds a complete, deterministic .xlsx Buffer from an array of sheet definitions:
 * [{ name, rows, columnWidths, freezeRows }]
 */
function buildXlsxWorkbookBuffer(sheetsInput) {
  const rawSheets = Array.isArray(sheetsInput) && sheetsInput.length > 0
    ? sheetsInput
    : [{ name: 'Summary', rows: [['No data available']] }];

  const usedSheetNames = new Set();
  const normalizedSheets = rawSheets.map((s, idx) => ({
    sheetId: idx + 1,
    rId: `rId${idx + 1}`,
    name: sanitizeWorksheetName(s.name || `Sheet${idx + 1}`, usedSheetNames),
    xml: buildWorksheetXml({
      rows: s.rows || [],
      columnWidths: s.columnWidths || [],
      freezeRows: s.freezeRows || 0
    })
  }));

  const stylesRelId = `rId${normalizedSheets.length + 1}`;

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...normalizedSheets.map(
      (s) =>
        `<Override PartName="/xl/worksheets/sheet${s.sheetId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
    '</Types>'
  ].join('');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>'
  ].join('');

  const workbookXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets>',
    ...normalizedSheets.map(
      (s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`
    ),
    '</sheets>',
    '</workbook>'
  ].join('');

  const workbookRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...normalizedSheets.map(
      (s) =>
        `<Relationship Id="${s.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.sheetId}.xml"/>`
    ),
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>'
  ].join('');

  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<fonts count="3">',
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="12"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
    '</fonts>',
    '<fills count="3">',
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>',
    '</fills>',
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '<cellXfs count="4">',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>',
    '</cellXfs>',
    '</styleSheet>'
  ].join('');

  const zipEntries = [
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    { name: 'xl/styles.xml', data: stylesXml },
    ...normalizedSheets.map((s) => ({
      name: `xl/worksheets/sheet${s.sheetId}.xml`,
      data: s.xml
    }))
  ];

  const buffer = buildDeterministicZip(zipEntries);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    sha256,
    sizeBytes: buffer.length,
    mimeType: XLSX_MIME_TYPE,
    sheetNames: normalizedSheets.map((s) => s.name)
  };
}

/**
 * Unescapes XML entities back to plain text when inspecting generated XLSX buffers in tests.
 */
function unescapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Parses a ZIP/XLSX buffer generated by buildXlsxWorkbookBuffer (or standard deflate ZIP)
 * and extracts worksheet names and structured rows/cells for verification and testing.
 */
function parseXlsxWorkbookBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('Invalid XLSX buffer.');
  }

  const files = new Map();
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressedSlice = buffer.slice(dataStart, dataStart + compressedSize);

    const uncompressed = compressionMethod === 8
      ? zlib.inflateRawSync(compressedSlice)
      : compressedSlice;

    files.set(name, uncompressed.toString('utf8'));
    offset = dataStart + compressedSize;
  }

  const workbookXml = files.get('xl/workbook.xml') || '';
  const sheetDefinitions = [];
  const sheetTagRegex = /<sheet\s+name="([^"]*)"\s+sheetId="(\d+)"\s+r:id="([^"]*)"\s*\/>/g;
  let match;
  while ((match = sheetTagRegex.exec(workbookXml)) !== null) {
    sheetDefinitions.push({
      name: unescapeXml(match[1]),
      sheetId: Number(match[2]),
      rId: match[3]
    });
  }

  const sheets = sheetDefinitions.map((def) => {
    const sheetXml = files.get(`xl/worksheets/sheet${def.sheetId}.xml`) || '';
    const rows = [];
    const rowRegex = /<row\s+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
      const rowBody = rowMatch[2];
      const rowValues = [];
      const cellRegex = /<c\s+r="([A-Z]+)\d+"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowBody)) !== null) {
        const colLetters = cellMatch[1];
        const attrs = cellMatch[2] || '';
        const inner = cellMatch[3] || '';

        let colIndex = 0;
        for (let i = 0; i < colLetters.length; i++) {
          colIndex = colIndex * 26 + (colLetters.charCodeAt(i) - 64);
        }
        colIndex -= 1;

        while (rowValues.length < colIndex) {
          rowValues.push(null);
        }

        if (!inner) {
          rowValues[colIndex] = null;
        } else if (/t="n"/.test(attrs)) {
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
          rowValues[colIndex] = vMatch ? Number(vMatch[1]) : null;
        } else if (/t="b"/.test(attrs)) {
          const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
          rowValues[colIndex] = vMatch ? vMatch[1] === '1' : false;
        } else {
          const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
          rowValues[colIndex] = tMatch ? unescapeXml(tMatch[1]) : '';
        }
      }
      rows.push(rowValues);
    }

    return {
      name: def.name,
      sheetId: def.sheetId,
      rows
    };
  });

  return {
    sheetNames: sheets.map((s) => s.name),
    sheets
  };
}

/**
 * Sanitizes a filename for Content-Disposition and Google Drive storage.
 */
function sanitizeWorkbookFilename(rawFilename) {
  const cleaned = String(rawFilename || 'attendance-workbook.xlsx')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.endsWith('.xlsx') ? cleaned : `${cleaned}.xlsx`;
}

module.exports = {
  XLSX_MIME_TYPE,
  MAX_SHEET_NAME_LENGTH,
  sanitizeFormulaCellText,
  sanitizeWorksheetName,
  sanitizeWorkbookFilename,
  buildXlsxWorkbookBuffer,
  parseXlsxWorkbookBuffer
};
