'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const NATIVE_BIN = path.join(__dirname, '..', 'bin', 'render_pdf_page');
const SWIFT_SRC = path.join(__dirname, '..', 'bin', 'render_pdf_page.swift');

// In-flight renders map to deduplicate concurrent requests for the same page
const inFlightRenders = new Map();

function isValidPngBuffer(buf) {
  return Buffer.isBuffer(buf) &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4E &&
    buf[3] === 0x47;
}

function getCacheDir() {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    const tmpCache = path.join(os.tmpdir(), 'gu_page_cache');
    try {
      if (!fs.existsSync(tmpCache)) {
        fs.mkdirSync(tmpCache, { recursive: true });
      }
      return tmpCache;
    } catch (_) {
      return os.tmpdir();
    }
  }

  const defaultDir = path.join(__dirname, '..', 'uploads', 'page-cache');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    return defaultDir;
  } catch (_) {
    const fallbackDir = path.join(os.tmpdir(), 'gu_page_cache');
    try {
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    } catch (_) {
      return os.tmpdir();
    }
  }
}

function ensureNativeBinary() {
  if (process.platform !== 'darwin') return false;
  if (fs.existsSync(NATIVE_BIN)) return true;
  if (!fs.existsSync(SWIFT_SRC)) return false;

  try {
    execFileSync('swiftc', ['-O', SWIFT_SRC, '-o', NATIVE_BIN], { timeout: 20000 });
    return fs.existsSync(NATIVE_BIN);
  } catch (_) {
    return false;
  }
}

/**
 * Universal PDF page renderer using pdfjs-dist and @napi-rs/canvas.
 * Runs reliably on Linux, macOS, and Vercel serverless without any external system packages.
 */
async function renderWithCanvas(pdfPath, pageNumber, scale) {
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const fileBytes = fs.readFileSync(pdfPath);
    const data = new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0
    });
    const pdfDoc = await loadingTask.promise;
    if (pageNumber > pdfDoc.numPages) {
      return null;
    }
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: Number(scale) || 1.5 });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer('image/png');
    if (isValidPngBuffer(pngBuffer)) {
      return pngBuffer;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Native macOS Apple Quartz/PDFKit rendering via compiled binary or swift runner.
 */
async function renderWithNativeDarwin(pdfPath, pageNumber, scale, targetFile) {
  if (process.platform !== 'darwin') return null;
  const hasBinary = ensureNativeBinary();
  if (hasBinary) {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          NATIVE_BIN,
          [path.resolve(pdfPath), String(pageNumber), targetFile, String(scale)],
          { timeout: 10000 },
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
      if (fs.existsSync(targetFile)) {
        const rendered = fs.readFileSync(targetFile);
        if (isValidPngBuffer(rendered)) return rendered;
      }
    } catch (_) {}
  } else if (fs.existsSync(SWIFT_SRC)) {
    try {
      await new Promise((resolve, reject) => {
        execFile(
          'swift',
          [SWIFT_SRC, path.resolve(pdfPath), String(pageNumber), targetFile, String(scale)],
          { timeout: 15000 },
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
      if (fs.existsSync(targetFile)) {
        const rendered = fs.readFileSync(targetFile);
        if (isValidPngBuffer(rendered)) return rendered;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * System pdftoppm renderer for Linux environments with poppler-utils installed.
 */
async function renderWithPdftoppm(pdfPath, pageNumber, scale, cacheDir, hashKey) {
  try {
    const tmpPrefix = path.join(cacheDir, `ppm_${hashKey}_${Date.now()}`);
    const dpi = Math.round(100 * (Number(scale) || 1.5));
    await new Promise((resolve, reject) => {
      execFile(
        'pdftoppm',
        ['-png', '-f', String(pageNumber), '-l', String(pageNumber), '-r', String(dpi), path.resolve(pdfPath), tmpPrefix],
        { timeout: 10000 },
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
    const candidateFiles = [
      `${tmpPrefix}-${pageNumber}.png`,
      `${tmpPrefix}-0${pageNumber}.png`,
      `${tmpPrefix}-00${pageNumber}.png`,
      `${tmpPrefix}-1.png`,
      `${tmpPrefix}-01.png`
    ];
    for (const cand of candidateFiles) {
      if (fs.existsSync(cand)) {
        const data = fs.readFileSync(cand);
        try { fs.unlinkSync(cand); } catch (_) {}
        if (isValidPngBuffer(data)) return data;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Renders a single page from a PDF file into a PNG image Buffer.
 *
 * Tier 1: macOS Apple Quartz / PDFKit native binary (~40ms)
 * Tier 2: Universal Node.js pdfjs-dist + @napi-rs/canvas (Linux / Vercel Serverless / macOS)
 * Tier 3: Linux pdftoppm (if poppler-utils is installed)
 * Tier 4: Graceful null fallback (Kyana uses text-only visual evidence)
 *
 * @param {Object} params
 * @param {string} params.pdfPath - Absolute or relative path to PDF file
 * @param {number} [params.pageNumber=1] - 1-based page number
 * @param {number} [params.scale=1.5] - Render scale multiplier
 * @param {string} [params.fileChecksum] - Optional file checksum for stable caching
 * @returns {Promise<Buffer|null>} Valid PNG buffer or null
 */
async function renderPdfPageToBuffer({ pdfPath, pageNumber = 1, scale = 1.5, fileChecksum = null }) {
  if (!pdfPath || typeof pdfPath !== 'string') return null;
  if (!fs.existsSync(pdfPath)) return null;
  const pNum = Number(pageNumber);
  if (!Number.isInteger(pNum) || pNum < 1) return null;

  let fileStat = null;
  try {
    fileStat = fs.statSync(pdfPath);
    if (!fileStat || fileStat.size === 0) return null;
  } catch (_) {
    return null;
  }

  const cacheDir = getCacheDir();
  const fileMtime = fileStat.mtimeMs || 0;
  const fileSize = fileStat.size || 0;

  const hashKey = crypto
    .createHash('sha256')
    .update(
      fileChecksum
        ? `chk_${fileChecksum}_${pNum}_scale_${scale}`
        : `${path.resolve(pdfPath)}_${fileMtime}_${fileSize}_${pNum}_scale_${scale}`
    )
    .digest('hex');

  const cacheFile = path.join(cacheDir, `${hashKey}.png`);

  // 1. Check disk cache
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = fs.readFileSync(cacheFile);
      if (isValidPngBuffer(cached)) {
        return cached;
      }
      // If file was corrupted or 0 bytes, remove it
      try { fs.unlinkSync(cacheFile); } catch (_) {}
    } catch (_) {}
  }

  // 2. Concurrency deduplication: reuse active in-flight render promise
  if (inFlightRenders.has(hashKey)) {
    return inFlightRenders.get(hashKey);
  }

  const renderExecutionPromise = (async () => {
    let resultBuffer = null;

    // Tier 1: macOS Native Quartz / PDFKit
    if (process.platform === 'darwin') {
      resultBuffer = await renderWithNativeDarwin(pdfPath, pNum, scale, cacheFile);
      if (resultBuffer) return resultBuffer;
    }

    // Tier 2: Universal Node.js pdfjs-dist + @napi-rs/canvas (Linux / Vercel Serverless / macOS fallback)
    resultBuffer = await renderWithCanvas(pdfPath, pNum, scale);
    if (resultBuffer) {
      try {
        const tmpFile = `${cacheFile}.tmp_${Date.now()}`;
        fs.writeFileSync(tmpFile, resultBuffer);
        fs.renameSync(tmpFile, cacheFile);
      } catch (_) {}
      return resultBuffer;
    }

    // Tier 3: pdftoppm (Linux poppler-utils)
    resultBuffer = await renderWithPdftoppm(pdfPath, pNum, scale, cacheDir, hashKey);
    if (resultBuffer) {
      try {
        const tmpFile = `${cacheFile}.tmp_${Date.now()}`;
        fs.writeFileSync(tmpFile, resultBuffer);
        fs.renameSync(tmpFile, cacheFile);
      } catch (_) {}
      return resultBuffer;
    }

    // Tier 4: Graceful null
    return null;
  })();

  inFlightRenders.set(hashKey, renderExecutionPromise);

  try {
    return await renderExecutionPromise;
  } finally {
    inFlightRenders.delete(hashKey);
  }
}

module.exports = {
  renderPdfPageToBuffer,
  isValidPngBuffer,
  getCacheDir,
  getInFlightRendersCount: () => inFlightRenders.size,
  renderWithCanvas,
  renderWithNativeDarwin,
  renderWithPdftoppm
};
