const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const db = new Database(path.join(__dirname, 'database.db'));

// --- Uploads folder setup ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

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

app.use(session({
  name: '__gu_session',
  secret: process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 6 // 6 hours
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
const PROTECTED_PAGES = new Set([
  '/dashboard.html', '/dashboard',
  '/files.html', '/files',
  '/library.html', '/library',
  '/syllabus.html', '/syllabus',
  '/routine.html', '/routine',
  '/profile.html', '/profile',
  '/chat.html', '/chat'
]);

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

  const isProtected = PROTECTED_PAGES.has(norm) ||
    norm.startsWith('/dashboard') ||
    norm.startsWith('/files') ||
    norm.startsWith('/library') ||
    norm.startsWith('/routine') ||
    norm.startsWith('/syllabus') ||
    norm.startsWith('/profile') ||
    norm.startsWith('/chat');

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
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'library.html'));
});

app.get('/syllabus', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'syllabus.html'));
});

app.get('/routine', (req, res) => {
  if (!req.session || !req.session.studentId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'routine.html'));
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

// --- Ensure tables exist ---
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    studentId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    passwordHash TEXT NOT NULL
  )
`);

try { db.exec(`ALTER TABLE students ADD COLUMN avatarUrl TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE students ADD COLUMN bio TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE students ADD COLUMN department TEXT DEFAULT 'B.Sc. CSIT'`); } catch (e) {}
try { db.exec(`ALTER TABLE students ADD COLUMN semester TEXT DEFAULT 'Semester 1'`); } catch (e) {}
try { db.exec(`ALTER TABLE students ADD COLUMN githubUrl TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE students ADD COLUMN linkedinUrl TEXT`); } catch (e) {}
try {
  db.exec(`ALTER TABLE students ADD COLUMN role TEXT DEFAULT 'student'`);
} catch (e) {
  // Column already exists — safe to ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS follows (
    followerId TEXT NOT NULL,
    followingId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (followerId, followingId),
    FOREIGN KEY (followerId) REFERENCES students(studentId),
    FOREIGN KEY (followingId) REFERENCES students(studentId)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storedName TEXT NOT NULL,
    originalName TEXT NOT NULL,
    title TEXT,
    uploadedBy TEXT NOT NULL,
    sizeBytes INTEGER NOT NULL,
    uploadedAt TEXT NOT NULL,
    FOREIGN KEY (uploadedBy) REFERENCES students(studentId)
  )
`);
try {
  db.exec(`ALTER TABLE files ADD COLUMN subject TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}
try {
  db.exec(`ALTER TABLE files ADD COLUMN chapter TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}
// If upgrading from an older database that doesn't have the title column yet
try {
  db.exec(`ALTER TABLE files ADD COLUMN title TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}
try {
  db.exec(`ALTER TABLE files ADD COLUMN semester TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}
try {
  db.exec(`ALTER TABLE files ADD COLUMN previewName TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS file_likes (
    fileId INTEGER NOT NULL,
    studentId TEXT NOT NULL,
    PRIMARY KEY (fileId, studentId)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS file_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fileId INTEGER NOT NULL,
    studentId TEXT NOT NULL,
    commentText TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId TEXT NOT NULL,
    text TEXT,
    attachmentName TEXT,
    attachmentOriginalName TEXT,
    attachmentMimeType TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (studentId) REFERENCES students(studentId)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipientStudentId TEXT NOT NULL,
    type TEXT NOT NULL,
    relatedFileId INTEGER,
    message TEXT NOT NULL,
    isRead INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipientStudentId) REFERENCES students(studentId)
  )
`);

// --- Routes ---

app.post('/api/login', loginRateLimiter, (req, res) => {
  const studentId = (req.body.studentId || '').trim();
  const password = req.body.password || '';
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  if (!studentId || !password) {
    return res.status(400).json({ message: 'Student ID and password are required.' });
  }

  const student = db.prepare('SELECT * FROM students WHERE studentId = ?').get(studentId);

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
    return res.json({ message: 'Login successful', redirect: '/dashboard.html' });
  });
});

app.get('/api/me', requireLogin, (req, res) => {
  const student = db.prepare('SELECT studentId, name, role FROM students WHERE studentId = ?').get(req.session.studentId);

  if (!student) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: 'Authentication required' });
  }

  const role = student.role || 'student';
  const isAdmin = role === 'admin';
  res.json({ studentId: student.studentId, name: student.name, role, isAdmin });
});
app.post('/api/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long' });
  }

  const student = db.prepare('SELECT * FROM students WHERE studentId = ?').get(req.session.studentId);
  if (!student) {
    return res.status(404).json({ message: 'User not found' });
  }

  const match = bcrypt.compareSync(currentPassword, student.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Incorrect current password' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE students SET passwordHash = ? WHERE studentId = ?').run(newHash, req.session.studentId);

  res.json({ message: 'Password successfully updated' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('__gu_session');
    res.json({ message: 'Logged out' });
  });
});

// Helper to check if a studentId is admin in database
function isStudentAdmin(studentId) {
  if (!studentId) return false;
  const s = db.prepare('SELECT role FROM students WHERE studentId = ?').get(studentId);
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

  const stmt = db.prepare(`
    INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, previewName)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const isAdmin = isStudentAdmin(req.session.studentId);
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

    if (ext === '.pptx') {
      // 1. Try LibreOffice PDF conversion first (preserving actual slide layout and design)
      if (isLibreOfficeAvailable()) {
        try {
          const startTime = Date.now();
          const pdfBuf = await convertPptxToPdf(filePath);
          previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.pdf';
          fs.writeFileSync(path.join(UPLOAD_DIR, previewFilename), pdfBuf);
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
          fs.writeFileSync(path.join(UPLOAD_DIR, previewFilename), previewHtml, 'utf8');
        } catch (err) {
          console.error(`[PPTX Text Extraction Error for ${f.originalname}]:`, err.message);
          previewFilename = null; // Graceful fallback to normal download
        }
      }
    } else if (ext === '.docx') {
      try {
        const previewHtml = await generateDocxPreview(filePath, fileTitle, f.originalname, null);
        previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
        fs.writeFileSync(path.join(UPLOAD_DIR, previewFilename), previewHtml, 'utf8');
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

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      const { f, fileTitle, previewFilename } = item;
      const result = stmt.run(
        f.filename,
        f.originalname,
        fileTitle,
        semester,
        subject,
        chapter,
        req.session.studentId,
        f.size,
        new Date().toISOString(),
        previewFilename
      );

      results.push({
        id: result.lastInsertRowid,
        storedName: f.filename,
        originalName: f.originalname,
        title: fileTitle,
        previewName: previewFilename
      });

      if (isAdmin) {
        db.prepare(`
          INSERT INTO notifications (recipientStudentId, type, relatedFileId, message)
          SELECT studentId, 'notice', ?, ? FROM students WHERE studentId != ?
        `).run(result.lastInsertRowid, `New Official Notice: ${fileTitle || f.originalname}`, req.session.studentId);
      }
    }
  });

  try {
    insertMany(processedItems);
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

app.get('/api/files', requireLogin, (req, res) => {
  const viewerIsAdmin = isStudentAdmin(req.session.studentId);

  const files = db.prepare(`
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    ORDER BY files.uploadedAt DESC
  `).all(req.session.studentId);

  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === req.session.studentId
  }));

  res.json(processed);
});

// Delete a post/file (Admins can delete any post; students can only delete their own)
app.delete('/api/files/:id', requireLogin, (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  // Verify role directly from database
  const viewer = db.prepare('SELECT role FROM students WHERE studentId = ?').get(studentId);
  if (!viewer) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const isAdmin = viewer.role === 'admin';
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);

  if (!file) {
    return res.status(404).json({ message: 'File/post not found' });
  }

  // Permission Check: only admin or original uploader
  if (!isAdmin && file.uploadedBy !== studentId) {
    return res.status(403).json({ message: 'Forbidden: You can only delete your own posts.' });
  }

  // Remove physical file and preview from uploads/
  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Error removing file from disk:', err);
    }
  }
  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) {}
    }
  }

  // Remove related likes, comments, and database row
  db.prepare('DELETE FROM file_likes WHERE fileId = ?').run(fileId);
  db.prepare('DELETE FROM file_comments WHERE fileId = ?').run(fileId);
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Support POST /api/files/:id/delete alias
app.post('/api/files/:id/delete', requireLogin, (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  const viewer = db.prepare('SELECT role FROM students WHERE studentId = ?').get(studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });

  const isAdmin = viewer.role === 'admin';
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (!isAdmin && file.uploadedBy !== studentId) {
    return res.status(403).json({ message: 'Forbidden: You can only delete your own posts.' });
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) {}
  }
  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) {}
    }
  }

  db.prepare('DELETE FROM file_likes WHERE fileId = ?').run(fileId);
  db.prepare('DELETE FROM file_comments WHERE fileId = ?').run(fileId);
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Batch delete all files in a specific chapter/unit
app.post(['/api/library/chapters/delete-files', '/api/library/chapters/files/delete'], requireLogin, (req, res) => {
  const studentId = req.session.studentId;
  const viewer = db.prepare('SELECT role FROM students WHERE studentId = ?').get(studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });
  const isAdmin = viewer.role === 'admin';

  let { subject, chapter, fileIds } = req.body || {};
  let targetFiles = [];

  if (Array.isArray(fileIds) && fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    targetFiles = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...fileIds);
  } else if (subject && chapter) {
    if (isAdmin) {
      targetFiles = db.prepare('SELECT * FROM files WHERE subject = ? AND chapter = ?').all(subject, chapter);
    } else {
      targetFiles = db.prepare('SELECT * FROM files WHERE subject = ? AND chapter = ? AND uploadedBy = ?').all(subject, chapter, studentId);
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
  const deleteBatch = db.transaction((filesToDelete) => {
    for (const f of filesToDelete) {
      // Remove physical file from uploads/
      const filePath = path.join(UPLOAD_DIR, path.basename(f.storedName));
      if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (err) {}
      }
      // Remove preview file from uploads/
      if (f.previewName) {
        const previewPath = path.join(UPLOAD_DIR, path.basename(f.previewName));
        if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
          try { fs.unlinkSync(previewPath); } catch (err) {}
        }
      }

      db.prepare('DELETE FROM file_likes WHERE fileId = ?').run(f.id);
      db.prepare('DELETE FROM file_comments WHERE fileId = ?').run(f.id);
      db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
      deletedCount++;
    }
  });

  try {
    deleteBatch(targetFiles);
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

app.get(['/api/files/:id/download', '/api/files/download/:id'], requireLogin, (req, res) => {
  const fileId = req.params.id;
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));

  if (!isSafeUploadPath(filePath) || !fs.existsSync(filePath)) {
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
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  // 1. If an HTML or PDF preview was pre-generated (e.g. for PPTX or DOCX), serve it
  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      if (file.previewName.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName.replace(/\.pptx$/i, '.pdf'))}"`);
        return res.sendFile(previewPath);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(previewPath);
    }
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));

  if (!isSafeUploadPath(filePath) || !fs.existsSync(filePath)) {
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
        db.prepare('UPDATE files SET previewName = ? WHERE id = ?').run(previewFilename, file.id);
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
      db.prepare('UPDATE files SET previewName = ? WHERE id = ?').run(previewFilename, file.id);
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
      db.prepare('UPDATE files SET previewName = ? WHERE id = ?').run(previewFilename, file.id);
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
app.post('/api/files/:id/like', requireLogin, (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const existing = db.prepare('SELECT 1 FROM file_likes WHERE fileId = ? AND studentId = ?').get(fileId, studentId);

  if (existing) {
    db.prepare('DELETE FROM file_likes WHERE fileId = ? AND studentId = ?').run(fileId, studentId);
  } else {
    db.prepare('INSERT INTO file_likes (fileId, studentId) VALUES (?, ?)').run(fileId, studentId);
    
    // Create notification
    const file = db.prepare('SELECT uploadedBy, originalName FROM files WHERE id = ?').get(fileId);
    if (file && file.uploadedBy !== studentId) {
      db.prepare('INSERT INTO notifications (recipientStudentId, type, relatedFileId, message) VALUES (?, ?, ?, ?)').run(
        file.uploadedBy, 'like', fileId, `${req.session.name || 'Someone'} liked your file: ${file.originalName}`
      );
    }
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM file_likes WHERE fileId = ?').get(fileId).c;
  res.json({ liked: !existing, likeCount: count });
});

// List comments on a file
app.get('/api/files/:id/comments', requireLogin, (req, res) => {
  const comments = db.prepare(`
    SELECT file_comments.id, file_comments.commentText, file_comments.createdAt, students.name AS commenterName
    FROM file_comments
    JOIN students ON students.studentId = file_comments.studentId
    WHERE fileId = ?
    ORDER BY file_comments.createdAt ASC
  `).all(req.params.id);

  res.json(comments);
});

// Add a comment to a file
app.post('/api/files/:id/comments', requireLogin, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (text.length > 500) return res.status(400).json({ message: 'Comment too long' });

  const result = db.prepare(`
    INSERT INTO file_comments (fileId, studentId, commentText, createdAt) VALUES (?, ?, ?, ?)
  `).run(req.params.id, req.session.studentId, text, new Date().toISOString());

  // Create notification
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const file = db.prepare('SELECT uploadedBy, originalName FROM files WHERE id = ?').get(fileId);
  if (file && file.uploadedBy !== studentId) {
    db.prepare('INSERT INTO notifications (recipientStudentId, type, relatedFileId, message) VALUES (?, ?, ?, ?)').run(
      file.uploadedBy, 'comment', fileId, `${req.session.name || 'Someone'} commented on your file: ${file.originalName}`
    );
  }

  res.json({ commentId: result.lastInsertRowid });
});
// List all subjects that have at least one file
app.get('/api/library/subjects', requireLogin, (req, res) => {
  const subjects = db.prepare(`
    SELECT subject, COUNT(*) AS fileCount, COUNT(DISTINCT chapter) AS chapterCount
    FROM files
    WHERE subject IS NOT NULL AND subject != ''
    GROUP BY subject
    ORDER BY subject COLLATE NOCASE ASC
  `).all();

  res.json(subjects);
});

// List chapters within a subject
app.get('/api/library/subjects/:subject/chapters', requireLogin, (req, res) => {
  const chapters = db.prepare(`
    SELECT chapter, COUNT(*) AS fileCount
    FROM files
    WHERE subject = ? AND chapter IS NOT NULL AND chapter != ''
    GROUP BY chapter
    ORDER BY chapter COLLATE NOCASE ASC
  `).all(req.params.subject);

  const uncategorized = db.prepare(`
    SELECT COUNT(*) AS c FROM files WHERE subject = ? AND (chapter IS NULL OR chapter = '')
  `).get(req.params.subject);

  res.json({ chapters, uncategorizedCount: uncategorized.c });
});

// Library stats: returns file count grouped by semester, subject, and chapter
app.get('/api/library/stats', requireLogin, (req, res) => {
  const stats = db.prepare(`
    SELECT semester, subject, chapter, COUNT(*) AS fileCount
    FROM files
    GROUP BY semester, subject, chapter
  `).all();
  res.json(stats);
});

// List files with flexible filters (semester, subject, chapter)
app.get('/api/library/files', requireLogin, (req, res) => {
  const { semester, subject, chapter } = req.query;
  const viewerIsAdmin = isStudentAdmin(req.session.studentId);

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
  const params = [req.session.studentId];

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

  const files = db.prepare(query).all(...params);
  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === req.session.studentId
  }));

  res.json(processed);
});

// Search across files and subjects
app.get('/api/search', requireLogin, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ files: [], subjects: [] });
  }

  const likeQuery = `%${q}%`;
  const viewerIsAdmin = isStudentAdmin(req.session.studentId);

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
  const files = db.prepare(filesQuery).all(req.session.studentId, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);

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
    ORDER BY subject COLLATE NOCASE ASC
    LIMIT 20
  `;
  const subjects = db.prepare(subjectsQuery).all(likeQuery);

  res.json({ files: processedFiles, subjects });
});

// ============================================================
// GROUP CHAT SYSTEM
// ============================================================

app.get('/api/chat/messages', requireLogin, (req, res) => {
  const since = parseInt(req.query.since) || 0;
  
  const messages = db.prepare(`
    SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.createdAt,
      students.studentId, students.name, students.avatarUrl
    FROM chat_messages
    JOIN students ON students.studentId = chat_messages.studentId
    WHERE chat_messages.id > ?
    ORDER BY chat_messages.id ASC
    LIMIT 200
  `).all(since);
  
  res.json(messages);
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

app.post('/api/chat/messages', requireLogin, chatRateLimiter, handleChatUpload, (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  const file = req.file;

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
  }

  try {
    const result = db.prepare(`
      INSERT INTO chat_messages (studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.session.studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, new Date().toISOString());

    res.json({ message: 'Sent', messageId: result.lastInsertRowid });
  } catch (error) {
    console.error('Chat message insert error:', error.message);
    res.status(500).json({ message: 'Failed to send message.' });
  }
});

app.get('/api/chat/attachment/:filename', requireLogin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!isSafeUploadPath(filePath)) {
    return res.status(403).json({ message: 'Invalid file path' });
  }

  const msg = db.prepare('SELECT 1 FROM chat_messages WHERE attachmentName = ?').get(filename);
  if (!msg) {
    return res.status(403).json({ message: 'Unauthorized or missing attachment' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(filePath);
});
// ============================================================
// NOTIFICATION SYSTEM
// ============================================================

app.get('/api/notifications/unread-count', requireLogin, (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE recipientStudentId = ? AND isRead = 0').get(req.session.studentId);
  res.json({ count: row.count });
});

app.get('/api/notifications', requireLogin, (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE recipientStudentId = ? ORDER BY createdAt DESC LIMIT 20').all(req.session.studentId);
  res.json(notifications);
});

app.post('/api/notifications/:id/read', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  const result = db.prepare('UPDATE notifications SET isRead = 1 WHERE id = ? AND recipientStudentId = ?').run(id, req.session.studentId);
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
function getStudentProfile(targetStudentId, viewerStudentId) {
  const student = db.prepare(`
    SELECT studentId, name, avatarUrl, bio, department, semester, githubUrl, linkedinUrl, role
    FROM students
    WHERE studentId = ?
  `).get(targetStudentId);

  if (!student) return null;

  const filesCount = db.prepare('SELECT COUNT(*) AS c FROM files WHERE uploadedBy = ?').get(targetStudentId).c;
  
  const likesReceived = db.prepare(`
    SELECT COUNT(*) AS c
    FROM file_likes
    JOIN files ON files.id = file_likes.fileId
    WHERE files.uploadedBy = ?
  `).get(targetStudentId).c;

  const followersCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followingId = ?').get(targetStudentId).c;
  const followingCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followerId = ?').get(targetStudentId).c;

  const isSelf = targetStudentId === viewerStudentId;
  const isFollowing = !isSelf && !!db.prepare('SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?').get(viewerStudentId, targetStudentId);
  const role = student.role || 'student';

  return {
    studentId: student.studentId,
    name: student.name,
    avatarUrl: student.avatarUrl || null,
    bio: student.bio || '',
    department: student.department || 'B.Sc. CSIT',
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
    isFollowing
  };
}

// Get logged-in student's profile
app.get('/api/profile', requireLogin, (req, res) => {
  const profile = getStudentProfile(req.session.studentId, req.session.studentId);
  if (!profile) return res.status(404).json({ message: 'Profile not found' });
  res.json(profile);
});

// Get any student's profile by ID
app.get('/api/profile/:studentId', requireLogin, (req, res) => {
  const profile = getStudentProfile(req.params.studentId, req.session.studentId);
  if (!profile) return res.status(404).json({ message: 'Student profile not found' });
  res.json(profile);
});

// Update profile details
app.post('/api/profile/update', requireLogin, (req, res) => {
  const { name, bio, department, semester, githubUrl, linkedinUrl } = req.body;
  const studentId = req.session.studentId;

  const current = db.prepare('SELECT * FROM students WHERE studentId = ?').get(studentId);
  if (!current) return res.status(404).json({ message: 'Student not found' });

  const updatedName = (name && name.trim()) ? name.trim() : current.name;
  const updatedBio = typeof bio === 'string' ? bio.trim().slice(0, 300) : (current.bio || '');
  const updatedDept = (department && department.trim()) ? department.trim().slice(0, 50) : (current.department || 'B.Sc. CSIT');
  const updatedSem = (semester && semester.trim()) ? semester.trim().slice(0, 30) : (current.semester || 'Semester 1');
  const updatedGithub = typeof githubUrl === 'string' ? githubUrl.trim().slice(0, 100) : (current.githubUrl || '');
  const updatedLinkedin = typeof linkedinUrl === 'string' ? linkedinUrl.trim().slice(0, 100) : (current.linkedinUrl || '');

  db.prepare(`
    UPDATE students
    SET name = ?, bio = ?, department = ?, semester = ?, githubUrl = ?, linkedinUrl = ?
    WHERE studentId = ?
  `).run(updatedName, updatedBio, updatedDept, updatedSem, updatedGithub, updatedLinkedin, studentId);

  // Update session name if changed
  req.session.name = updatedName;

  const profile = getStudentProfile(studentId, studentId);
  res.json({ message: 'Profile updated successfully', profile });
});

// Upload profile avatar picture
app.post('/api/profile/avatar', requireLogin, uploadAvatar.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded.' });
  }

  const studentId = req.session.studentId;
  const avatarUrl = `/api/avatar/${req.file.filename}`;

  db.prepare('UPDATE students SET avatarUrl = ? WHERE studentId = ?').run(avatarUrl, studentId);

  res.json({ message: 'Profile picture updated successfully', avatarUrl });
});

// Serve avatar image safely
app.get('/api/avatar/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!isSafeUploadPath(filePath) || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Avatar image not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
  res.sendFile(filePath);
});

// Toggle follow/unfollow a student
app.post('/api/profile/:studentId/follow', requireLogin, (req, res) => {
  const followerId = req.session.studentId;
  const followingId = req.params.studentId;

  if (followerId === followingId) {
    return res.status(400).json({ message: 'You cannot follow yourself.' });
  }

  const target = db.prepare('SELECT studentId FROM students WHERE studentId = ?').get(followingId);
  if (!target) return res.status(404).json({ message: 'Student not found.' });

  const existing = db.prepare('SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?').get(followerId, followingId);

  if (existing) {
    db.prepare('DELETE FROM follows WHERE followerId = ? AND followingId = ?').run(followerId, followingId);
  } else {
    db.prepare('INSERT INTO follows (followerId, followingId, createdAt) VALUES (?, ?, ?)').run(followerId, followingId, new Date().toISOString());
  }

  const followersCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followingId = ?').get(followingId).c;
  res.json({ isFollowing: !existing, followersCount });
});

// List followers of a student
app.get('/api/profile/:studentId/followers', requireLogin, (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;

  const followers = db.prepare(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM follows
    JOIN students ON students.studentId = follows.followerId
    WHERE follows.followingId = ?
    ORDER BY follows.createdAt DESC
  `).all(viewerStudentId, targetStudentId);

  res.json(followers);
});

// List students that this student is following
app.get('/api/profile/:studentId/following', requireLogin, (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;

  const following = db.prepare(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM follows
    JOIN students ON students.studentId = follows.followingId
    WHERE follows.followerId = ?
    ORDER BY follows.createdAt DESC
  `).all(viewerStudentId, targetStudentId);

  res.json(following);
});

// Get all files uploaded by a student
app.get('/api/profile/:studentId/files', requireLogin, (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session.studentId;
  const viewerIsAdmin = isStudentAdmin(viewerStudentId);

  const files = db.prepare(`
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.uploadedBy = ?
    ORDER BY files.uploadedAt DESC
  `).all(viewerStudentId, targetStudentId);

  const processed = files.map(f => ({
    ...f,
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === viewerStudentId
  }));

  res.json(processed);
});

// Suggested classmates to follow
app.get('/api/students/suggested', requireLogin, (req, res) => {
  const viewerStudentId = req.session.studentId;

  const classmates = db.prepare(`
    SELECT students.studentId, students.name, students.avatarUrl, students.department, students.semester,
      (SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount,
      EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = students.studentId) AS isFollowing
    FROM students
    WHERE students.studentId != ?
    ORDER BY filesCount DESC, students.name ASC
    LIMIT 12
  `).all(viewerStudentId, viewerStudentId);

  res.json(classmates);
});

// --- AI Assistant Service ---
const aiAssistant = require('./ai-assistant');

// AI Rate Limiter: Max 20 messages per student per hour
const aiRateLimits = new Map(); // studentId -> { count, windowStart }
const AI_RATE_LIMIT_MAX = 20;
const AI_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function aiRateLimiter(req, res, next) {
  const studentId = req.session.studentId;
  const now = Date.now();
  const record = aiRateLimits.get(studentId) || { count: 0, windowStart: now };

  if (now - record.windowStart > AI_RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count += 1;
  }
  aiRateLimits.set(studentId, record);

  if (record.count > AI_RATE_LIMIT_MAX) {
    const remainingMinutes = Math.ceil((record.windowStart + AI_RATE_LIMIT_WINDOW - now) / (60 * 1000));
    return res.status(429).json({
      message: `Hourly AI limit reached (${AI_RATE_LIMIT_MAX} requests/hr). Please wait ${remainingMinutes} minute(s) before asking again.`
    });
  }
  next();
}

app.post('/api/ai/chat', requireLogin, aiRateLimiter, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const student = db.prepare('SELECT studentId, name, department, semester FROM students WHERE studentId = ?').get(req.session.studentId);
    const result = await aiAssistant.handleChat(db, message, student || { studentId: req.session.studentId }, history || []);
    res.json(result);
  } catch (err) {
    console.error('[API /api/ai/chat Error]:', err.message);
    res.status(500).json({ message: err.message || 'An error occurred while processing your request.' });
  }
});

app.get('/api/ai/suggestions', requireLogin, (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Semester Library server running at http://localhost:${PORT}`);
});