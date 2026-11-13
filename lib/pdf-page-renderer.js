'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const CACHE_DIR = path.join(__dirname, '..', 'uploads', 'page-cache');
const NATIVE_BIN = path.join(__dirname, '..', 'bin', 'render_pdf_page');
const SWIFT_SRC = path.join(__dirname, '..', 'bin', 'render_pdf_page.swift');

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    return CACHE_DIR;
  } catch (_) {
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
 * Renders a single page from a PDF file into a PNG image Buffer.
 *
 * @param {Object} params
 * @param {string} params.pdfPath - Absolute or relative path to PDF file
 * @param {number} params.pageNumber - 1-based page number
 * @param {number} [params.scale=1.5] - Render scale / resolution multiplier
 * @returns {Promise<Buffer|null>} PNG buffer or null if rendering fails
 */
async function renderPdfPageToBuffer({ pdfPath, pageNumber = 1, scale = 1.5 }) {
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;
  const pNum = Number(pageNumber) || 1;
  if (pNum < 1) return null;

  const cacheDir = ensureCacheDir();
  const hashKey = crypto
    .createHash('sha256')
    .update(`${path.resolve(pdfPath)}_${pNum}_scale_${scale}`)
    .digest('hex');
  const cacheFile = path.join(cacheDir, `${hashKey}.png`);

  // Check cache first
  if (fs.existsSync(cacheFile)) {
    try {
      const cachedBuf = fs.readFileSync(cacheFile);
      if (cachedBuf.length > 0) return cachedBuf;
    } catch (_) {}
  }

  // 1. Try macOS native binary (or compile on the fly from Swift source)
  if (process.platform === 'darwin') {
    const hasBinary = ensureNativeBinary();
    if (hasBinary) {
      try {
        const renderPromise = new Promise((resolve, reject) => {
          execFile(
            NATIVE_BIN,
            [path.resolve(pdfPath), String(pNum), cacheFile, String(scale)],
            { timeout: 10000 },
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        await renderPromise;
        if (fs.existsSync(cacheFile)) {
          const rendered = fs.readFileSync(cacheFile);
          if (rendered.length > 0) return rendered;
        }
      } catch (_) {}
    } else if (fs.existsSync(SWIFT_SRC)) {
      try {
        const runPromise = new Promise((resolve, reject) => {
          execFile(
            'swift',
            [SWIFT_SRC, path.resolve(pdfPath), String(pNum), cacheFile, String(scale)],
            { timeout: 15000 },
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        await runPromise;
        if (fs.existsSync(cacheFile)) {
          const rendered = fs.readFileSync(cacheFile);
          if (rendered.length > 0) return rendered;
        }
      } catch (_) {}
    }
  }

  // 2. Try pdftoppm if installed (Linux / container / fallback)
  try {
    const tmpPrefix = path.join(cacheDir, `ppm_${hashKey}`);
    const ppmPromise = new Promise((resolve, reject) => {
      execFile(
        'pdftoppm',
        ['-png', '-f', String(pNum), '-l', String(pNum), '-r', '150', path.resolve(pdfPath), tmpPrefix],
        { timeout: 10000 },
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
    await ppmPromise;
    const generated = [
      `${tmpPrefix}-${pNum}.png`,
      `${tmpPrefix}-0${pNum}.png`,
      `${tmpPrefix}-00${pNum}.png`,
      `${tmpPrefix}-1.png`,
      `${tmpPrefix}-01.png`
    ];
    for (const cand of generated) {
      if (fs.existsSync(cand)) {
        const data = fs.readFileSync(cand);
        try { fs.renameSync(cand, cacheFile); } catch (_) {}
        if (data.length > 0) return data;
      }
    }
  } catch (_) {}

  return null;
}

module.exports = {
  renderPdfPageToBuffer
};
