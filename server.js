const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const db = require('./db');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
let broadcastChannel = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    broadcastChannel = supabase.channel('public:chat_messages');
    broadcastChannel.subscribe();
  } catch (err) {
    console.warn('[Supabase Client Warning]:', err.message);
  }
}

function sendBroadcast(event, payload) {
  if (!broadcastChannel) return;
  broadcastChannel.send({
    type: 'broadcast',
    event: event,
    payload: payload
  }).catch(err => {
    console.error('Broadcast error:', err);
  });
}

const app = express();

// --- Uploads folder setup (use /tmp on Vercel read-only serverless runtime) ---
const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB per file
});

const chatUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed as chat attachments.'));
    }
  }
});

// --- Security Headers & Body Parsing ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());

// Path Traversal Security Validator
function isSafeUploadPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(path.resolve(UPLOAD_DIR));
}

// Restore file from Database Blob to local disk cache if missing on serverless instance
async function ensureLocalFile(filename) {
  if (!filename) return null;
  const safeFilename = path.basename(filename);
  const localPath = path.join(UPLOAD_DIR, safeFilename);

  if (isSafeUploadPath(localPath) && fs.existsSync(localPath)) {
    return localPath;
  }

  // File not found on local disk (e.g. fresh lambda container) — restore from DB Blob
  const blob = await db.getFileBlob(safeFilename);
  if (blob && blob.fileData) {
    try {
      fs.writeFileSync(localPath, blob.fileData);
      return localPath;
    } catch (err) {
      console.error(`[Blob Cache Write Error for ${safeFilename}]:`, err.message);
    }
  }
  return null;
}

class CustomDbStore extends session.Store {
  async get(sid, callback) {
    try {
      // For PostgreSQL we can use CURRENT_TIMESTAMP or NOW() but to keep it universal, we just fetch and compare in JS, or we can just rely on the DB
      let row;
      if (db.isPostgres) {
        row = await db.get('SELECT sess FROM session WHERE sid = $1 AND expire >= CURRENT_TIMESTAMP', sid);
      } else {
        row = await db.get('SELECT sess FROM session WHERE sid = ? AND expire >= CURRENT_TIMESTAMP', sid);
      }
      if (!row) return callback(null, null);
      let data = row.sess;
      if (typeof data === 'string') data = JSON.parse(data);
      callback(null, data);
    } catch (err) {
      console.error('[Session Get Error]:', err.message);
      callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const expireDate = sessionData.cookie && sessionData.cookie.expires ? new Date(sessionData.cookie.expires) : new Date(Date.now() + 86400000);
      const expire = expireDate.toISOString();
      const sessString = JSON.stringify(sessionData);
      
      if (db.isPostgres) {
        await db.run(
          `INSERT INTO session (sid, sess, expire) VALUES ($1, $2::json, $3)
           ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
           RETURNING sid`,
          sid, sessString, expire
        );
      } else {
        await db.run(
          `INSERT OR REPLACE INTO session (sid, sess, expire) VALUES (?, ?, ?)`,
          sid, sessString, expire
        );
      }
      if (callback) callback(null);
    } catch (err) {
      console.error('[Session Set Error]:', err.message);
      if (callback) callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      if (db.isPostgres) {
        await db.run('DELETE FROM session WHERE sid = $1', sid);
      } else {
        await db.run('DELETE FROM session WHERE sid = ?', sid);
      }
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

const sessionStore = new CustomDbStore();

app.set('trust proxy', 1);

app.use(session({
  store: sessionStore,
  name: '__gu_session',
  secret: process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days persistent session
  }
}));

// --- Login Rate Limiter (Brute-Force Defense) ---
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const record = loginAttempts.get(ip);
  const now = Date.now();

  if (record && record.lockedUntil && record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return res.status(429).json({
      message: `Too many failed attempts. Security cooldown: ${remainingSec}s remaining.`
    });
  }
  next();
}

const chatRateLimits = new Map(); // studentId -> { count, lastReset }

function chatRateLimiter(req, res, next) {
  if (!req.session || !req.session.studentId) return next();
  const studentId = req.session.studentId;
  const now = Date.now();
  const record = chatRateLimits.get(studentId) || { count: 0, lastReset: now };
  
  if (now - record.lastReset > 10000) { // 10 seconds window
    record.count = 1;
    record.lastReset = now;
  } else {
    record.count += 1;
  }
  chatRateLimits.set(studentId, record);
  
  if (record.count > 5) {
    return res.status(429).json({ message: 'Sending messages too fast. Please wait a moment.' });
  }
  next();
}

// --- Strict Server-Side Page Route Guards ---
const PROTECTED_PAGES = new Set([]);

app.use((req, res, next) => {
  // Canonical path normalization
  let raw = req.path || '/';
  try {
    raw = decodeURIComponent(raw.split('?')[0]);
  } catch (e) {
    raw = raw.split('?')[0];
  }
  let norm = path.posix.normalize(raw).toLowerCase();
  while (norm.length > 1 && norm.endsWith('/')) {
    norm = norm.slice(0, -1);
  }

  const isProtected = PROTECTED_PAGES.has(norm);

  // If attempting to access any protected student page without an active session
  if (isProtected) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (!req.session || !req.session.studentId) {
      return res.redirect('/login.html');
    }
  }

  next();
});

// Clean URL Aliases for Protected and Public Pages
app.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/files', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'files.html'));
});

app.get('/library', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'library.html'));
});

app.get('/syllabus', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'syllabus.html'));
});

app.get('/routine', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'routine.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/semesters', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'semesters.html'));
});

app.get('/notices', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notices.html'));
});

app.get('/semester/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'semester.html'));
});

app.get('/profile', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/chat', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get(['/chatbot', '/assistant'], (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve static assets securely
app.use(express.static(path.join(__dirname, 'public')));

function requireLogin(req, res, next) {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }
  next();
}

// --- Routes ---

app.post('/api/login', loginRateLimiter, async (req, res) => {
  const studentId = (req.body.studentId || '').trim();
  const password = req.body.password || '';
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  if (!studentId || !password) {
    return res.status(400).json({ message: 'Student ID and password are required.' });
  }

  const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);

  if (!student) {
    // Record failed attempt
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= 5) {
      record.lockedUntil = Date.now() + 5 * 60 * 1000;
    }
    loginAttempts.set(ip, record);
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  const match = bcrypt.compareSync(password, student.passwordHash);

  if (!match) {
    // Record failed attempt
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= 5) {
      record.lockedUntil = Date.now() + 5 * 60 * 1000;
    }
    loginAttempts.set(ip, record);
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  // Clear failed attempt record upon successful authentication
  loginAttempts.delete(ip);

  // Regenerate session to eliminate session fixation vulnerabilities
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ message: 'Authentication session creation error.' });
    }
    req.session.studentId = student.studentId;
    req.session.studentName = student.name;
    req.session.role = student.role || 'student';
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error:', saveErr);
        return res.status(500).json({ message: 'Authentication session creation error.' });
      }
      return res.json({ message: 'Login successful', redirect: '/dashboard.html' });
    });
  });
});

app.get('/api/me', requireLogin, async (req, res) => {
  if (req.session.studentId === 'guest') {
    return res.json({ studentId: 'guest', name: 'Guest User', role: 'student', isAdmin: false });
  }

  const student = await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', req.session.studentId);

  if (!student) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: 'Authentication required' });
  }

  const role = student.role || 'student';
  const isAdmin = role === 'admin';
  res.json({ studentId: student.studentId, name: student.name, role, isAdmin });
});

app.post('/api/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long' });
  }

  const student = await db.get('SELECT * FROM students WHERE studentId = ?', req.session.studentId);
  if (!student) {
    return res.status(404).json({ message: 'User not found' });
  }

  const match = bcrypt.compareSync(currentPassword, student.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Incorrect current password' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE students SET passwordHash = ? WHERE studentId = ?', newHash, req.session.studentId);

  res.json({ message: 'Password successfully updated' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('__gu_session');
    res.json({ message: 'Logged out' });
  });
});

// Helper to check if a studentId is admin in database
async function isStudentAdmin(studentId) {
  if (!studentId) return false;
  const s = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  return s && s.role === 'admin';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapDocPreviewHtml({ title, originalName, fileId, type, typeLabel, contentHtml, disclaimerText }) {
  const downloadUrl = fileId ? `/api/files/${fileId}/download` : '#';
  const badgeClass = type === 'pptx' ? 'pres-type-badge' : 'doc-type-badge';
  const badgeText = type === 'pptx' ? 'PPTX' : 'DOCX';
  const defaultDisclaimer = type === 'pptx'
    ? 'Text extracted from slides — for full formatting and design, download the original file.'
    : 'Formatted document preview extracted from Word file — for original fonts, layout, and embedded objects, download the original file.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || originalName)} — Document Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --navy: #0f172a;
      --brass: #b45309;
      --brass-bg: #fffbeb;
      --brass-border: #fde68a;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: rgba(15, 23, 42, 0.1);
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
      --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -1px rgba(0,0,0,0.04);
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 0 0 60px;
    }

    .preview-navbar {
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1.5px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .btn-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      background: #f1f5f9;
      color: var(--navy);
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 980px;
      border: 1px solid var(--border);
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .btn-back:hover {
      background: #e2e8f0;
      transform: translateX(-2px);
    }

    .file-title-head {
      font-size: 14px;
      font-weight: 700;
      color: var(--navy);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .btn-download-original {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 18px;
      border-radius: 980px;
      background: var(--navy);
      color: #ffffff;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15);
      flex-shrink: 0;
    }

    .btn-download-original:hover {
      background: #000000;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
    }

    .preview-container {
      max-width: 840px;
      margin: 28px auto 0;
      padding: 0 20px;
    }

    .preview-disclaimer {
      background: var(--brass-bg);
      border: 1px solid var(--brass-border);
      color: var(--brass);
      border-radius: var(--radius-md);
      padding: 12px 18px;
      margin-bottom: 22px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.45;
    }

    .preview-disclaimer svg {
      flex-shrink: 0;
    }

    .doc-header-card {
      background: var(--card-bg);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 26px 30px;
      margin-bottom: 22px;
      box-shadow: var(--shadow-sm);
    }

    .doc-badge-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .pres-type-badge {
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      background: #fed7aa;
      color: #9a3412;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .doc-type-badge {
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      background: #dbeafe;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .doc-meta-tag {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .doc-title {
      font-family: 'Fraunces', serif;
      font-size: 24px;
      font-weight: 700;
      color: var(--navy);
      margin: 0 0 4px;
      letter-spacing: -0.02em;
    }

    .doc-filename {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
    }

    /* Slide Card */
    .slide-card {
      background: var(--card-bg);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: 18px;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .slide-card:hover {
      border-color: rgba(15, 23, 42, 0.25);
      box-shadow: var(--shadow-md);
    }

    .slide-card-header {
      background: #f8fafc;
      border-bottom: 1.5px solid var(--border);
      padding: 10px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .slide-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 800;
      color: var(--navy);
      background: #ffffff;
      border: 1px solid var(--border);
      padding: 3px 10px;
      border-radius: 980px;
    }

    .slide-count {
      font-size: 11.5px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .slide-card-body {
      padding: 20px 24px;
      font-size: 14.5px;
      color: #1e293b;
      line-height: 1.7;
    }

    .slide-card-body p {
      margin-bottom: 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .slide-card-body p:last-child {
      margin-bottom: 0;
    }

    /* Docx Content Card */
    .docx-content-card {
      background: var(--card-bg);
      border: 1.5px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 36px 40px;
      box-shadow: var(--shadow-sm);
      font-size: 15px;
      color: #1e293b;
      line-height: 1.8;
    }

    .docx-content-card h1, .docx-content-card h2, .docx-content-card h3 {
      font-family: 'Fraunces', serif;
      color: var(--navy);
      margin: 24px 0 12px;
    }

    .docx-content-card p {
      margin-bottom: 14px;
    }

    .docx-content-card ul, .docx-content-card ol {
      margin: 12px 0 16px 24px;
    }

    .docx-content-card table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }

    .docx-content-card th, .docx-content-card td {
      border: 1px solid var(--border);
      padding: 8px 12px;
    }

    .empty-slide-note {
      font-style: italic;
      color: var(--text-muted);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <header class="preview-navbar">
    <div class="nav-left">
      <a href="javascript:history.back()" class="btn-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        <span>Back</span>
      </a>
      <span class="file-title-head">${escapeHtml(title || originalName)}</span>
    </div>
    <a href="${downloadUrl}" class="btn-download-original" download>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
      <span>Download ${type === 'pptx' ? 'Presentation' : 'Document'}</span>
    </a>
  </header>

  <main class="preview-container">
    <div class="preview-disclaimer">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>${escapeHtml(disclaimerText || defaultDisclaimer)}</span>
    </div>

    <div class="doc-header-card">
      <div class="doc-badge-row">
        <span class="${badgeClass}">${badgeText}</span>
        <span class="doc-meta-tag">${escapeHtml(typeLabel || '')}</span>
      </div>
      <h1 class="doc-title">${escapeHtml(title || originalName)}</h1>
      <p class="doc-filename">${escapeHtml(originalName)}</p>
    </div>

    <div class="preview-main-content">
      ${contentHtml}
    </div>
  </main>
</body>
</html>`;
}

async function generatePptxPreview(filePath, title, originalName, fileId) {
  const PptxParserRaw = require('node-pptx-parser');
  const PptxParser = PptxParserRaw.default || PptxParserRaw;
  const parser = new PptxParser(filePath);
  const slides = await parser.extractText();

  const totalSlides = (slides && slides.length) || 0;
  let slidesHtml = '';

  if (totalSlides === 0) {
    slidesHtml = `
      <div class="slide-card">
        <div class="slide-card-body">
          <p class="empty-slide-note">No slides found in this presentation.</p>
        </div>
      </div>
    `;
  } else {
    slides.forEach((slide, idx) => {
      const rawTexts = Array.isArray(slide.text) ? slide.text : (slide.text ? [slide.text] : []);
      const cleanParagraphs = rawTexts
        .map(t => typeof t === 'string' ? t.trim() : '')
        .filter(t => t.length > 0);

      let bodyContent = '';
      if (cleanParagraphs.length === 0) {
        bodyContent = '<p class="empty-slide-note">No text content detected on this slide (may contain only images, shapes, or diagrams).</p>';
      } else {
        bodyContent = cleanParagraphs.map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('\n');
      }

      slidesHtml += `
        <div class="slide-card">
          <div class="slide-card-header">
            <span class="slide-badge">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Slide ${idx + 1}
            </span>
            <span class="slide-count">Slide ${idx + 1} of ${totalSlides}</span>
          </div>
          <div class="slide-card-body">
            ${bodyContent}
          </div>
        </div>
      `;
    });
  }

  return wrapDocPreviewHtml({
    title,
    originalName,
    fileId,
    type: 'pptx',
    typeLabel: `${totalSlides} Slide${totalSlides === 1 ? '' : 's'}`,
    contentHtml: `<div class="slides-stack">${slidesHtml}</div>`
  });
}

async function generateDocxPreview(filePath, title, originalName, fileId) {
  const mammoth = require('mammoth');
  const result = await mammoth.convertToHtml({ path: filePath });
  const html = result.value || '<p class="empty-slide-note">No text content found in document.</p>';
  return wrapDocPreviewHtml({
    title,
    originalName,
    fileId,
    type: 'docx',
    typeLabel: 'Word Document',
    contentHtml: `<div class="docx-content-card">${html}</div>`
  });
}

function getLibreOfficeBinaryPath() {
  const possiblePaths = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const which = require('child_process').execSync('which soffice', { stdio: 'pipe' }).toString().trim();
    if (which) return which;
  } catch (e) {}
  return null;
}

function isLibreOfficeAvailable() {
  return !!getLibreOfficeBinaryPath();
}

async function convertPptxToPdf(filePath) {
  const libreoffice = require('libreoffice-convert');
  const util = require('util');
  const libreConvert = util.promisify(libreoffice.convertWithOptions || libreoffice.convert);
  const inputBuf = fs.readFileSync(filePath);
  const sofficePath = getLibreOfficeBinaryPath();
  const options = sofficePath ? { sofficeBinaryPaths: [sofficePath] } : {};
  const pdfBuf = await libreConvert(inputBuf, '.pdf', undefined, options);
  return pdfBuf;
}

// --- File upload system ---

function handleFileUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'One or more files exceed the 25MB size limit.' });
        }
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ message: err.message || 'Error processing uploaded files.' });
    }
    next();
  });
}

app.post('/api/files/upload', requireLogin, handleFileUpload, async (req, res) => {
  const uploadedFiles = req.files || (req.file ? [req.file] : []);
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ message: 'No file was uploaded.' });
  }

  const title = (req.body.title || '').trim() || null;
  const semester = (req.body.semester || '').trim() || null;
  const subject = (req.body.subject || '').trim() || null;
  const chapter = (req.body.chapter || '').trim() || null;

  const isAdmin = await isStudentAdmin(req.session.studentId);
  const processedItems = [];

  // Generate previews asynchronously (e.g. for PPTX via LibreOffice PDF / node-pptx-parser or DOCX via mammoth)
  for (let i = 0; i < uploadedFiles.length; i++) {
    const f = uploadedFiles[i];
    let fileTitle = title;
    if (uploadedFiles.length > 1 && title) {
      fileTitle = `${title} (${f.originalname.replace(/\.[^/.]+$/, '')})`;
    } else if (!fileTitle) {
      fileTitle = f.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    }

    let previewFilename = null;
    const ext = path.extname(f.originalname).toLowerCase();
    const filePath = path.join(UPLOAD_DIR, f.filename);

    // Save main file to persistent blob storage
    try {
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        await db.saveFileBlob(f.filename, fileBuffer, f.mimetype || 'application/octet-stream');
      }
    } catch (err) {
      console.warn(`[Blob Save Warning for ${f.originalname}]:`, err.message);
    }

    if (ext === '.pptx') {
      // 1. Try LibreOffice PDF conversion first (preserving actual slide layout and design)
      if (isLibreOfficeAvailable()) {
        try {
          const startTime = Date.now();
          const pdfBuf = await convertPptxToPdf(filePath);
          previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.pdf';
          const previewPath = path.join(UPLOAD_DIR, previewFilename);
          fs.writeFileSync(previewPath, pdfBuf);
          await db.saveFileBlob(previewFilename, pdfBuf, 'application/pdf');
          console.log(`[LibreOffice PPTX->PDF Success]: Converted ${f.originalname} in ${Date.now() - startTime}ms`);
        } catch (err) {
          console.warn(`[LibreOffice PPTX->PDF Error, falling back to text extraction]: ${err.message}`);
          previewFilename = null;
        }
      }

      // 2. Fallback to text extraction preview if LibreOffice was not available or failed
      if (!previewFilename) {
        try {
          const previewHtml = await generatePptxPreview(filePath, fileTitle, f.originalname, null);
          previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
          const previewPath = path.join(UPLOAD_DIR, previewFilename);
          fs.writeFileSync(previewPath, previewHtml, 'utf8');
          await db.saveFileBlob(previewFilename, Buffer.from(previewHtml, 'utf8'), 'text/html');
        } catch (err) {
          console.error(`[PPTX Text Extraction Error for ${f.originalname}]:`, err.message);
          previewFilename = null; // Graceful fallback to normal download
        }
      }
    } else if (ext === '.docx') {
      try {
        const previewHtml = await generateDocxPreview(filePath, fileTitle, f.originalname, null);
        previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
        const previewPath = path.join(UPLOAD_DIR, previewFilename);
        fs.writeFileSync(previewPath, previewHtml, 'utf8');
        await db.saveFileBlob(previewFilename, Buffer.from(previewHtml, 'utf8'), 'text/html');
      } catch (err) {
        console.error(`[DOCX Preview Generation Error for ${f.originalname}]:`, err.message);
        previewFilename = null; // Graceful fallback
      }
    }

    processedItems.push({
      f,
      fileTitle,
      previewFilename
    });
  }

  const results = [];

  try {
    for (const item of processedItems) {
      const { f, fileTitle, previewFilename } = item;
      const result = await db.run(`
        INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, previewName)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, f.filename, f.originalname, fileTitle, semester, subject, chapter, req.session.studentId, f.size, new Date().toISOString(), previewFilename);

      const insertedId = result.lastInsertRowid;
      results.push({
        id: insertedId,
        storedName: f.filename,
        originalName: f.originalname,
        title: fileTitle,
        previewName: previewFilename
      });

      if (isAdmin && insertedId) {
        if (db.isPostgres) {
          await db.run(`
            INSERT INTO notifications (recipientStudentId, type, relatedFileId, message)
            SELECT studentId, 'notice', ?, ? FROM students WHERE studentId != ?
          `, insertedId, `New Official Notice: ${fileTitle || f.originalname}`, req.session.studentId);
        } else {
          await db.run(`
            INSERT INTO notifications (recipientStudentId, type, relatedFileId, message)
            SELECT studentId, 'notice', ?, ? FROM students WHERE studentId != ?
          `, insertedId, `New Official Notice: ${fileTitle || f.originalname}`, req.session.studentId);
        }
      }
    }
  } catch (err) {
    console.error('File DB insert error:', err);
    return res.status(500).json({ message: 'Failed to save uploaded files.' });
  }

  res.json({
    message: `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} uploaded successfully`,
    fileId: results[0]?.id,
    files: results,
    count: uploadedFiles.length,
    isOfficial: isAdmin
  });
});

app.get('/api/files', requireLogin, async (req, res) => {
  const viewerIsAdmin = await isStudentAdmin(req.session.studentId);

  const files = await db.all(`
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    ORDER BY files.uploadedAt DESC
  `, req.session.studentId);

  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === req.session.studentId
  }));

  res.json(processed);
});

// Delete a post/file (Admins can delete any post; students can only delete their own)
app.delete('/api/files/:id', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  // Verify role directly from database
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const isAdmin = viewer.role === 'admin';
  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);

  if (!file) {
    return res.status(404).json({ message: 'File/post not found' });
  }

  // Permission Check: only admin or original uploader
  if (!isAdmin && file.uploadedBy !== studentId) {
    return res.status(403).json({ message: 'Forbidden: You can only delete your own posts.' });
  }

  // Remove physical file and preview from uploads/ and persistent blob store
  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) {}
  }
  await db.deleteFileBlob(file.storedName);

  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) {}
    }
    await db.deleteFileBlob(file.previewName);
  }

  // Remove related likes, comments, and database row
  await db.run('DELETE FROM file_likes WHERE fileId = ?', fileId);
  await db.run('DELETE FROM file_comments WHERE fileId = ?', fileId);
  await db.run('DELETE FROM files WHERE id = ?', fileId);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Support POST /api/files/:id/delete alias
app.post('/api/files/:id/delete', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });

  const isAdmin = viewer.role === 'admin';
  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (!isAdmin && file.uploadedBy !== studentId) {
    return res.status(403).json({ message: 'Forbidden: You can only delete your own posts.' });
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) {}
  }
  await db.deleteFileBlob(file.storedName);

  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) {}
    }
    await db.deleteFileBlob(file.previewName);
  }

  await db.run('DELETE FROM file_likes WHERE fileId = ?', fileId);
  await db.run('DELETE FROM file_comments WHERE fileId = ?', fileId);
  await db.run('DELETE FROM files WHERE id = ?', fileId);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Batch delete all files in a specific chapter/unit
app.post(['/api/library/chapters/delete-files', '/api/library/chapters/files/delete'], requireLogin, async (req, res) => {
  const studentId = req.session.studentId;
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });
  const isAdmin = viewer.role === 'admin';

  let { subject, chapter, fileIds } = req.body || {};
  let targetFiles = [];

  if (Array.isArray(fileIds) && fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    targetFiles = await db.all(`SELECT * FROM files WHERE id IN (${placeholders})`, ...fileIds);
  } else if (subject && chapter) {
    if (isAdmin) {
      targetFiles = await db.all('SELECT * FROM files WHERE subject = ? AND chapter = ?', subject, chapter);
    } else {
      targetFiles = await db.all('SELECT * FROM files WHERE subject = ? AND chapter = ? AND uploadedBy = ?', subject, chapter, studentId);
    }
  } else {
    return res.status(400).json({ message: 'Missing subject/chapter or fileIds parameter' });
  }

  if (!targetFiles || targetFiles.length === 0) {
    return res.status(404).json({ message: 'No deletable files found for this chapter.' });
  }

  // Security enforcement: Non-admins can only delete files they themselves uploaded
  if (!isAdmin) {
    targetFiles = targetFiles.filter(f => f.uploadedBy === studentId);
  }

  if (targetFiles.length === 0) {
    return res.status(403).json({ message: 'Forbidden: You do not have permission to delete these files.' });
  }

  let deletedCount = 0;
  try {
    for (const f of targetFiles) {
      const filePath = path.join(UPLOAD_DIR, path.basename(f.storedName));
      if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (err) {}
      }
      await db.deleteFileBlob(f.storedName);

      if (f.previewName) {
        const previewPath = path.join(UPLOAD_DIR, path.basename(f.previewName));
        if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
          try { fs.unlinkSync(previewPath); } catch (err) {}
        }
        await db.deleteFileBlob(f.previewName);
      }

      await db.run('DELETE FROM file_likes WHERE fileId = ?', f.id);
      await db.run('DELETE FROM file_comments WHERE fileId = ?', f.id);
      await db.run('DELETE FROM files WHERE id = ?', f.id);
      deletedCount++;
    }
  } catch (err) {
    console.error('Batch chapter delete error:', err);
    return res.status(500).json({ message: 'Failed to delete chapter files' });
  }

  res.json({
    success: true,
    count: deletedCount,
    message: `Successfully deleted ${deletedCount} note${deletedCount === 1 ? '' : 's'} from ${chapter || 'unit'}`
  });
});

app.get(['/api/files/:id/download', '/api/files/download/:id'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const filePath = await ensureLocalFile(file.storedName);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File missing from server' });
  }

  res.download(filePath, file.originalName, (err) => {
    if (err && !res.headersSent) {
      console.error('Download error:', err);
      res.status(500).json({ message: 'Error downloading file' });
    }
  });
});

// View a file in-browser (requires login) — displays preview/inline instead of downloading
app.get('/api/files/:id/view', requireLogin, async (req, res) => {
  const file = await db.get('SELECT * FROM files WHERE id = ?', req.params.id);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  // 1. If an HTML or PDF preview was pre-generated (e.g. for PPTX or DOCX), serve it
  if (file.previewName) {
    const previewPath = await ensureLocalFile(file.previewName);
    if (previewPath && fs.existsSync(previewPath)) {
      if (file.previewName.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName.replace(/\.pptx$/i, '.pdf'))}"`);
        return res.sendFile(previewPath);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(previewPath);
    }
  }

  const filePath = await ensureLocalFile(file.storedName);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File missing from server' });
  }

  const ext = path.extname(file.originalName).toLowerCase();

  // 2. On-demand preview generation for PPTX / DOCX if not generated yet
  if (ext === '.pptx') {
    if (isLibreOfficeAvailable()) {
      try {
        const startTime = Date.now();
        const pdfBuf = await convertPptxToPdf(filePath);
        const previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.pdf';
        const previewPath = path.join(UPLOAD_DIR, previewFilename);
        fs.writeFileSync(previewPath, pdfBuf);
        await db.saveFileBlob(previewFilename, pdfBuf, 'application/pdf');
        await db.run('UPDATE files SET previewName = ? WHERE id = ?', previewFilename, file.id);
        console.log(`[On-Demand LibreOffice PPTX->PDF Success]: Converted ID ${file.id} in ${Date.now() - startTime}ms`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName.replace(/\.pptx$/i, '.pdf'))}"`);
        return res.sendFile(previewPath);
      } catch (err) {
        console.warn(`[On-Demand LibreOffice Error, falling back to text extraction]: ${err.message}`);
      }
    }
    // Fallback to text extraction
    try {
      const previewHtml = await generatePptxPreview(filePath, file.title, file.originalName, file.id);
      const previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
      const previewPath = path.join(UPLOAD_DIR, previewFilename);
      fs.writeFileSync(previewPath, previewHtml, 'utf8');
      await db.saveFileBlob(previewFilename, Buffer.from(previewHtml, 'utf8'), 'text/html');
      await db.run('UPDATE files SET previewName = ? WHERE id = ?', previewFilename, file.id);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(previewPath);
    } catch (err) {
      console.error(`[On-Demand PPTX Preview Error for ID ${file.id}]:`, err.message);
    }
  } else if (ext === '.docx') {
    try {
      const previewHtml = await generateDocxPreview(filePath, file.title, file.originalName, file.id);
      const previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
      const previewPath = path.join(UPLOAD_DIR, previewFilename);
      fs.writeFileSync(previewPath, previewHtml, 'utf8');
      await db.saveFileBlob(previewFilename, Buffer.from(previewHtml, 'utf8'), 'text/html');
      await db.run('UPDATE files SET previewName = ? WHERE id = ?', previewFilename, file.id);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(previewPath);
    } catch (err) {
      console.error(`[On-Demand DOCX Preview Error for ID ${file.id}]:`, err.message);
    }
  }

  // 3. For native browser viewable files (PDF, images, text, html)
  const inlineExts = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.txt', '.html'];
  if (inlineExts.includes(ext)) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    return res.sendFile(filePath);
  }

  // 4. Fallback: download the file
  res.download(filePath, file.originalName);
});

// Toggle like on a file
app.post('/api/files/:id/like', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  const existing = await db.get('SELECT 1 FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
  if (existing) {
    await db.run('DELETE FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
  } else {
    await db.run('INSERT INTO file_likes (fileId, studentId) VALUES (?, ?) RETURNING fileId', fileId, studentId);
    // Create notification
    const file = await db.get('SELECT uploadedBy, originalName FROM files WHERE id = ?', fileId);
    if (file && file.uploadedBy !== studentId) {
      await db.run('INSERT INTO notifications (recipientStudentId, type, relatedFileId, message) VALUES (?, ?, ?, ?) RETURNING id',
        file.uploadedBy, 'like', fileId, `${req.session.name || 'Someone'} liked your file: ${file.originalName}`
      );
    }
  }

  const countRow = await db.get('SELECT COUNT(*) AS c FROM file_likes WHERE fileId = ?', fileId);
  const count = Number(countRow?.c || countRow?.count || 0);
  res.json({ liked: !existing, likeCount: count });
});

// List comments on a file
app.get('/api/files/:id/comments', requireLogin, async (req, res) => {
  const comments = await db.all(`
    SELECT file_comments.id, file_comments.commentText, file_comments.createdAt, students.name AS commenterName
    FROM file_comments
    JOIN students ON students.studentId = file_comments.studentId
    WHERE fileId = ?
    ORDER BY file_comments.createdAt ASC
  `, req.params.id);

  res.json(comments);
});

// Add a comment to a file
app.post('/api/files/:id/comments', requireLogin, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (text.length > 500) return res.status(400).json({ message: 'Comment too long' });

  const result = await db.run(`
    INSERT INTO file_comments (fileId, studentId, commentText, createdAt) VALUES (?, ?, ?, ?)
  `, req.params.id, req.session.studentId, text, new Date().toISOString());

  // Create notification
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const file = await db.get('SELECT uploadedBy, originalName FROM files WHERE id = ?', fileId);
  if (file && file.uploadedBy !== studentId) {
    await db.run('INSERT INTO notifications (recipientStudentId, type, relatedFileId, message) VALUES (?, ?, ?, ?)',
      file.uploadedBy, 'comment', fileId, `${req.session.name || 'Someone'} commented on your file: ${file.originalName}`
    );
  }

  res.json({ commentId: result.lastInsertRowid });
});

// --- Routine/Exam Endpoints ---
app.get('/api/routine', async (req, res) => {
  try {
    const routine = await db.all('SELECT * FROM exam_schedule ORDER BY examDate ASC');
    res.json(routine);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch routine' });
  }
});

app.post('/api/routine', requireLogin, async (req, res) => {
  try {
    const student = await db.get('SELECT role FROM students WHERE studentId = ?', req.session.studentId);
    if (!student || student.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can add exam routines.' });
    }
    const { subject, examDate, semester, type, day, time } = req.body;
    if (!subject || !examDate || !semester) {
      return res.status(400).json({ error: 'Missing required fields: subject, examDate, semester' });
    }
    
    const timeStr = time || '11:30 AM'; 
    const dayStr = day || '';

    await db.run(
      'INSERT INTO exam_schedule (subject, examDate, day, time, semester, type) VALUES (?, ?, ?, ?, ?, ?)',
      subject, examDate, dayStr, timeStr, semester, type || 'Pre-board Examination'
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add routine' });
  }
});

// List all subjects that have at least one file
app.get('/api/library/subjects', async (req, res) => {
  const subjects = await db.all(`
    SELECT subject, COUNT(*) AS fileCount, COUNT(DISTINCT chapter) AS chapterCount
    FROM files
    WHERE subject IS NOT NULL AND subject != ''
    GROUP BY subject
    ORDER BY subject ASC
  `);

  res.json(subjects);
});

// List chapters within a subject
app.get('/api/library/subjects/:subject/chapters', async (req, res) => {
  const chapters = await db.all(`
    SELECT chapter, COUNT(*) AS fileCount
    FROM files
    WHERE subject = ? AND chapter IS NOT NULL AND chapter != ''
    GROUP BY chapter
    ORDER BY chapter ASC
  `, req.params.subject);

  const uncategorized = await db.get(`
    SELECT COUNT(*) AS c FROM files WHERE subject = ? AND (chapter IS NULL OR chapter = '')
  `, req.params.subject);

  res.json({ chapters, uncategorizedCount: Number(uncategorized?.c || 0) });
});

// Library stats: returns file count grouped by semester, subject, and chapter
app.get('/api/library/stats', async (req, res) => {
  const stats = await db.all(`
    SELECT semester, subject, chapter, COUNT(*) AS fileCount
    FROM files
    GROUP BY semester, subject, chapter
  `);
  res.json(stats);
});

// List files with flexible filters (semester, subject, chapter)
app.get('/api/library/files', async (req, res) => {
  const { semester, subject, chapter } = req.query;
  const studentId = req.session ? req.session.studentId : null;
  const viewerIsAdmin = studentId ? await isStudentAdmin(studentId) : false;

  let query = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE 1=1
  `;
  const params = [studentId || ''];

  if (semester) {
    query += ' AND files.semester = ?';
    params.push(semester);
  }
  if (subject) {
    query += ' AND files.subject = ?';
    params.push(subject);
  }
  if (chapter) {
    query += ' AND files.chapter = ?';
    params.push(chapter);
  }

  query += ' ORDER BY files.uploadedAt DESC';

  const files = await db.all(query, ...params);
  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === req.session.studentId
  }));

  res.json(processed);
});

// Search across files and subjects (public for homepage & library search)
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ files: [], subjects: [] });
  }

  const currentStudentId = req.session ? req.session.studentId : null;
  const likeQuery = `%${q}%`;
  const viewerIsAdmin = currentStudentId ? await isStudentAdmin(currentStudentId) : false;

  // Search files (title, originalName, subject, chapter)
  const filesQuery = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.title LIKE ? OR files.originalName LIKE ? OR files.subject LIKE ? OR files.chapter LIKE ? OR files.semester LIKE ?
    ORDER BY files.uploadedAt DESC
    LIMIT 50
  `;
  const files = await db.all(filesQuery, currentStudentId || '', likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);

  const processedFiles = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === req.session.studentId
  }));

  // Search subjects
  const subjectsQuery = `
    SELECT subject, COUNT(*) AS fileCount, COUNT(DISTINCT chapter) AS chapterCount
    FROM files
    WHERE subject IS NOT NULL AND subject != '' AND subject LIKE ?
    GROUP BY subject
    ORDER BY subject ASC
    LIMIT 20
  `;
  const subjects = await db.all(subjectsQuery, likeQuery);

  res.json({ files: processedFiles, subjects });
});

// ============================================================
// GROUP CHAT SYSTEM
// ============================================================

app.get('/api/chat/config', requireLogin, (req, res) => {
  res.json({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY });
});

app.get('/api/chat/messages', requireLogin, async (req, res) => {
  const since = parseInt(req.query.since) || 0;
  
  const messages = await db.all(`
    SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
      students.studentId, students.name, students.avatarUrl,
      reply_msg.text AS replyText, reply_student.name AS replySender
    FROM chat_messages
    LEFT JOIN students ON students.studentId = chat_messages.studentId
    LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
    LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
    WHERE chat_messages.id > ?
    ORDER BY chat_messages.id ASC
    LIMIT 200
  `, since);
  
  const messageIds = messages.map(m => m.id);
  if (messageIds.length > 0) {
    const placeholders = messageIds.map(() => '?').join(',');
    const reactions = await db.all(`SELECT messageId, studentId, emoji FROM chat_reactions WHERE messageId IN (${placeholders})`, ...messageIds);
    const reactionMap = {};
    reactions.forEach(r => {
      if (!reactionMap[r.messageId]) reactionMap[r.messageId] = [];
      reactionMap[r.messageId].push({ studentId: r.studentId, emoji: r.emoji });
    });
    messages.forEach(m => {
      m.reactions = reactionMap[m.id] || [];
    });
  }

  const readReceipts = await db.all(`SELECT studentId, lastReadMessageId FROM chat_read_receipts`);

  // We return an object now. We should keep backwards compatibility if the frontend still expects an array on `since > 0`, but we will update the frontend to handle { messages, readReceipts }.
  res.json({ messages, readReceipts });
});

app.post('/api/chat/reactions', requireLogin, async (req, res) => {
  const { messageId, emoji } = req.body;
  const studentId = req.session.studentId;
  if (!messageId || !emoji) return res.status(400).json({ error: 'Missing data' });
  
  try {
    const existing = await db.get(`SELECT * FROM chat_reactions WHERE messageId = ? AND studentId = ? AND emoji = ?`, messageId, studentId, emoji);
    if (existing) {
      await db.run(`DELETE FROM chat_reactions WHERE messageId = ? AND studentId = ? AND emoji = ?`, messageId, studentId, emoji);
    } else {
      await db.run(`INSERT INTO chat_reactions (messageId, studentId, emoji) VALUES (?, ?, ?)`, messageId, studentId, emoji);
    }
    
    sendBroadcast('reaction_update', { messageId, studentId, emoji, action: existing ? 'remove' : 'add' });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

app.post('/api/chat/read', requireLogin, async (req, res) => {
  const { lastReadMessageId } = req.body;
  const studentId = req.session.studentId;
  if (!lastReadMessageId) return res.status(400).json({ error: 'Missing data' });

  try {
    await db.run(`
      INSERT INTO chat_read_receipts (studentId, lastReadMessageId) VALUES (?, ?)
      ON CONFLICT(studentId) DO UPDATE SET lastReadMessageId = excluded.lastReadMessageId
    `, studentId, lastReadMessageId);

    sendBroadcast('read_receipt', { studentId, lastReadMessageId });

    res.json({ success: true });
  } catch (error) {
    console.error('Read receipt error:', error);
    res.status(500).json({ error: 'Failed to update read receipt' });
  }
});

app.post('/api/chat/typing', requireLogin, async (req, res) => {
  const studentId = req.session.studentId;
  const name = req.session.studentName;
  try {
    const now = new Date().toISOString();
    await db.run(`
      INSERT INTO chat_typing (studentId, lastTypedAt) VALUES (?, ?)
      ON CONFLICT(studentId) DO UPDATE SET lastTypedAt = excluded.lastTypedAt
    `, studentId, now);

    sendBroadcast('typing', { studentId, name, timestamp: now });

    res.json({ success: true });
  } catch (error) {
    console.error('Typing error:', error);
    res.status(500).json({ error: 'Failed to update typing indicator' });
  }
});

const handleChatUpload = (req, res, next) => {
  chatUpload.single('attachment')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ message: err.message || String(err) });
    }
    next();
  });
};

app.post('/api/chat/messages', requireLogin, chatRateLimiter, handleChatUpload, async (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  const file = req.file;
  const replyToId = req.body.replyToId ? parseInt(req.body.replyToId, 10) : null;

  if (!text && !file) {
    return res.status(400).json({ message: 'Cannot send an empty message.' });
  }

  if (text.length > 2000) {
    if (file) fs.unlink(file.path, () => {});
    return res.status(400).json({ message: 'Message text is too long (max 2000 chars).' });
  }

  let attachmentName = null;
  let attachmentOriginalName = null;
  let attachmentMimeType = null;

  if (file) {
    attachmentName = file.filename;
    attachmentOriginalName = file.originalname;
    attachmentMimeType = file.mimetype;

    try {
      if (fs.existsSync(file.path)) {
        const fileBuffer = fs.readFileSync(file.path);
        await db.saveFileBlob(file.filename, fileBuffer, file.mimetype || 'application/octet-stream');
      }
    } catch (err) {
      console.warn(`[Chat Blob Save Warning for ${file.originalname}]:`, err.message);
    }
  }

  try {
    const result = await db.run(`
      INSERT INTO chat_messages (studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, replyToId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, req.session.studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, replyToId, new Date().toISOString());

    const messageId = result.lastInsertRowid;

    // Fetch the newly inserted message with all joins to broadcast it exactly as GET /api/chat/messages would
    const newMsg = await db.get(`
      SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
        students.studentId, students.name, students.avatarUrl,
        reply_msg.text AS replyText, reply_student.name AS replySender
      FROM chat_messages
      LEFT JOIN students ON students.studentId = chat_messages.studentId
      LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
      LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
      WHERE chat_messages.id = ?
    `, messageId);

    if (newMsg) {
      sendBroadcast('new_message', newMsg);
    }

    res.json({ message: 'Sent', messageId, data: newMsg });
  } catch (error) {
    console.error('Chat message insert error:', error.message);
    res.status(500).json({ message: 'Failed to send message.' });
  }
});

app.delete('/api/chat/messages/:id', requireLogin, async (req, res) => {
  const messageId = parseInt(req.params.id, 10);
  if (!messageId) return res.status(400).json({ error: 'Invalid message ID' });

  const studentId = req.session.studentId;
  const isAdmin = await isStudentAdmin(studentId);

  try {
    const msg = await db.get('SELECT * FROM chat_messages WHERE id = ?', messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    if (msg.studentId !== studentId && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this message' });
    }

    // Clean up foreign references & reactions
    await db.run('UPDATE chat_messages SET replyToId = NULL WHERE replyToId = ?', messageId);
    await db.run('DELETE FROM chat_reactions WHERE messageId = ?', messageId);
    await db.run('DELETE FROM chat_messages WHERE id = ?', messageId);

    // Broadcast message deletion to all clients
    sendBroadcast('delete_message', { messageId });

    res.json({ success: true, messageId });
  } catch (error) {
    console.error('Delete chat message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

app.get('/api/chat/attachment/:filename', requireLogin, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = await ensureLocalFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});

// ============================================================
// NOTIFICATION SYSTEM
// ============================================================

app.get('/api/notifications/unread-count', requireLogin, async (req, res) => {
  const row = await db.get('SELECT COUNT(*) as count FROM notifications WHERE recipientStudentId = ? AND isRead = 0', req.session.studentId);
  res.json({ count: Number(row?.count || 0) });
});

app.get('/api/notifications', requireLogin, async (req, res) => {
  const notifications = await db.all('SELECT * FROM notifications WHERE recipientStudentId = ? ORDER BY createdAt DESC LIMIT 20', req.session.studentId);
  res.json(notifications);
});

app.post('/api/notifications/:id/read', requireLogin, async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await db.run('UPDATE notifications SET isRead = 1 WHERE id = ? AND recipientStudentId = ?', id, req.session.studentId);
  if (result.changes > 0) {
    res.json({ success: true });
  } else {
    res.status(404).json({ message: 'Notification not found' });
  }
});

// ============================================================
// PROFILE & SOCIAL GRAPH SYSTEM
// ============================================================

// Multer storage for student profile avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar_${req.session.studentId}_${Date.now()}${ext}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed as profile photos.'));
    }
  }
});

// Helper function to fetch profile with stats
async function getStudentProfile(targetStudentId, viewerStudentId) {
  const student = await db.get(`
    SELECT studentId, name, avatarUrl, bio, department, semester, githubUrl, linkedinUrl, role
    FROM students
    WHERE studentId = ?
  `, targetStudentId);

  if (!student) return null;

  const filesCountRow = await db.get('SELECT COUNT(*) AS c FROM files WHERE uploadedBy = ?', targetStudentId);
  const filesCount = Number(filesCountRow?.c || 0);

  const likesReceivedRow = await db.get(`
    SELECT COUNT(*) AS c
    FROM file_likes
    JOIN files ON files.id = file_likes.fileId
    WHERE files.uploadedBy = ?
  `, targetStudentId);
  const likesReceived = Number(likesReceivedRow?.c || 0);

  const followersCountRow = await db.get('SELECT COUNT(*) AS c FROM follows WHERE followingId = ?', targetStudentId);
  const followersCount = Number(followersCountRow?.c || 0);

  const followingCountRow = await db.get('SELECT COUNT(*) AS c FROM follows WHERE followerId = ?', targetStudentId);
  const followingCount = Number(followingCountRow?.c || 0);

  const isSelf = targetStudentId === viewerStudentId;
  const followCheck = !isSelf && !!(await db.get('SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?', viewerStudentId, targetStudentId));
  const role = student.role || 'student';

  return {
    studentId: student.studentId,
    name: student.name,
    avatarUrl: student.avatarUrl || null,
    bio: student.bio || '',
    department: student.department || 'BIT',
    semester: student.semester || 'Semester 1',
    githubUrl: student.githubUrl || '',
    linkedinUrl: student.linkedinUrl || '',
    role,
    isAdmin: role === 'admin',
    stats: {
      filesCount,
      likesReceived,
      followersCount,
      followingCount
    },
    isSelf,
    isFollowing: followCheck
  };
}

// Get logged-in student's profile
app.get('/api/profile', requireLogin, async (req, res) => {
  const profile = await getStudentProfile(req.session.studentId, req.session.studentId);
  if (!profile) return res.status(404).json({ message: 'Profile not found' });
  res.json(profile);
});

// Get any student's profile by ID
app.get('/api/profile/:studentId', requireLogin, async (req, res) => {
  const profile = await getStudentProfile(req.params.studentId, req.session.studentId);
  if (!profile) return res.status(404).json({ message: 'Student profile not found' });
  res.json(profile);
});

// Update profile details
app.post('/api/profile/update', requireLogin, async (req, res) => {
  const { name, bio, department, semester, githubUrl, linkedinUrl } = req.body;
  const studentId = req.session.studentId;

  const current = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  if (!current) return res.status(404).json({ message: 'Student not found' });

  const updatedName = (name && name.trim()) ? name.trim() : current.name;
  const updatedBio = typeof bio === 'string' ? bio.trim().slice(0, 300) : (current.bio || '');
  const updatedDept = (department && department.trim()) ? department.trim().slice(0, 50) : (current.department || 'BIT');
  const updatedSem = (semester && semester.trim()) ? semester.trim().slice(0, 30) : (current.semester || 'Semester 1');
  const updatedGithub = typeof githubUrl === 'string' ? githubUrl.trim().slice(0, 100) : (current.githubUrl || '');
  const updatedLinkedin = typeof linkedinUrl === 'string' ? linkedinUrl.trim().slice(0, 100) : (current.linkedinUrl || '');

  await db.run(`
    UPDATE students
    SET name = ?, bio = ?, department = ?, semester = ?, githubUrl = ?, linkedinUrl = ?
    WHERE studentId = ?
  `, updatedName, updatedBio, updatedDept, updatedSem, updatedGithub, updatedLinkedin, studentId);

  // Update session name if changed
  req.session.studentName = updatedName;

  const profile = await getStudentProfile(studentId, studentId);
  res.json({ message: 'Profile updated successfully', profile });
});

// Upload profile avatar picture
app.post('/api/profile/avatar', requireLogin, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded.' });
  }

  const studentId = req.session.studentId;
  const avatarUrl = `/api/avatar/${req.file.filename}`;

  try {
    if (fs.existsSync(req.file.path)) {
      const fileBuf = fs.readFileSync(req.file.path);
      await db.saveFileBlob(req.file.filename, fileBuf, req.file.mimetype || 'image/jpeg');
    }
  } catch (err) {
    console.warn('[Avatar Blob Save Warning]:', err.message);
  }

  await db.run('UPDATE students SET avatarUrl = ? WHERE studentId = ?', avatarUrl, studentId);

  res.json({ message: 'Profile picture updated successfully', avatarUrl });
});

// Serve avatar image safely
app.get('/api/avatar/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = await ensureLocalFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Avatar image not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
  res.sendFile(filePath);
});

// Toggle follow/unfollow a student
app.post('/api/profile/:studentId/follow', requireLogin, async (req, res) => {
  const followerId = req.session.studentId;
  const followingId = req.params.studentId;

  if (followerId === followingId) {
    return res.status(400).json({ message: 'You cannot follow yourself.' });
  }

  const target = await db.get('SELECT studentId FROM students WHERE studentId = ?', followingId);
  if (!target) return res.status(404).json({ message: 'Student not found.' });

  const existing = await db.get('SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?', followerId, followingId);

  if (existing) {
    await db.run('DELETE FROM follows WHERE followerId = ? AND followingId = ?', followerId, followingId);
  } else {
    await db.run('INSERT INTO follows (followerId, followingId, createdAt) VALUES (?, ?, ?) RETURNING followerId', followerId, followingId, new Date().toISOString());
  }

  const countRow = await db.get('SELECT COUNT(*) AS c FROM follows WHERE followingId = ?', followingId);
  const followersCount = Number(countRow?.c || countRow?.count || 0);
  res.json({ isFollowing: !existing, followersCount });
});

// List followers of a student
app.get('/api/profile/:studentId/followers', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;

  const followers = await db.all(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM follows
    JOIN students ON students.studentId = follows.followerId
    WHERE follows.followingId = ?
    ORDER BY follows.createdAt DESC
  `, viewerStudentId, targetStudentId);

  res.json(followers);
});

// List students that this student is following
app.get('/api/profile/:studentId/following', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;

  const following = await db.all(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM follows
    JOIN students ON students.studentId = follows.followingId
    WHERE follows.followerId = ?
    ORDER BY follows.createdAt DESC
  `, viewerStudentId, targetStudentId);

  res.json(following);
});

// Get all files uploaded by a student
app.get('/api/profile/:studentId/files', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;
  const viewerIsAdmin = await isStudentAdmin(viewerStudentId);

  const files = await db.all(`
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.uploadedBy = ?
    ORDER BY files.uploadedAt DESC
  `, viewerStudentId, targetStudentId);

  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === viewerStudentId
  }));

  res.json(processed);
});

// Suggested classmates to follow
app.get('/api/students/suggested', requireLogin, async (req, res) => {
  const viewerStudentId = req.session.studentId;

  const classmates = await db.all(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      (SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM students
    WHERE students.studentId != ?
    ORDER BY filesCount DESC, students.name ASC
    LIMIT 12
  `, viewerStudentId, viewerStudentId);

  res.json(classmates);
});

// --- AI Assistant Service ---
const aiAssistant = require('./ai-assistant');

// AI Rate Limiter: Max 30 messages per user/IP per hour
const aiRateLimits = new Map(); // idOrIp -> { count, windowStart }
const AI_RATE_LIMIT_MAX = 30;
const AI_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function aiRateLimiter(req, res, next) {
  const clientId = (req.session && req.session.studentId) ? req.session.studentId : (req.ip || 'guest');
  const now = Date.now();
  const record = aiRateLimits.get(clientId) || { count: 0, windowStart: now };

  if (now - record.windowStart > AI_RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count += 1;
  }
  aiRateLimits.set(clientId, record);

  if (record.count > AI_RATE_LIMIT_MAX) {
    const remainingMinutes = Math.ceil((record.windowStart + AI_RATE_LIMIT_WINDOW - now) / (60 * 1000));
    return res.status(429).json({
      message: `Hourly AI limit reached (${AI_RATE_LIMIT_MAX} requests/hr). Please wait ${remainingMinutes} minute(s) before asking again.`
    });
  }
  next();
}

app.post('/api/ai/chat', aiRateLimiter, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'Message is required.' });
    }

    let student = null;
    if (req.session && req.session.studentId) {
      student = await db.get('SELECT studentId, name, department, semester FROM students WHERE studentId = ?', req.session.studentId);
    }
    const result = await aiAssistant.handleChat(db, message, student || { studentId: 'guest', name: 'Student' }, history || []);
    res.json(result);
  } catch (err) {
    console.error('[API /api/ai/chat Error]:', err.message);
    res.status(500).json({ message: err.message || 'An error occurred while processing your request.' });
  }
});

app.get('/api/ai/suggestions', (req, res) => {
  res.json([
    { label: '📚 Find Math notes', query: 'Give me notes on Math' },
    { label: '📖 What is in Semester 3?', query: "What's in semester 3?" },
    { label: '📅 When is the next exam?', query: "When's the exam?" },
    { label: '📤 How do I upload notes?', query: 'How do I upload notes to the library?' }
  ]);
});

// --- Global API Error Handler (Ensures all /api routes return JSON, never HTML) ---
app.use((err, req, res, next) => {
  console.error('[API Error]:', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      message: err.message || 'An unexpected server error occurred.'
    });
  }
  next(err);
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Semester Library server running at http://localhost:${PORT}`);
  });
}

module.exports = app;