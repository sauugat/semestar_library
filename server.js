const express = require('express');
const { isVerifiedQaEnvironment } = require('./lib/qa-guard');
if (process.env.COHORT_CHAT_LOCAL === '1' && process.env.NODE_ENV !== 'test' && !isVerifiedQaEnvironment()) {
  throw new Error('COHORT_CHAT_LOCAL requires NODE_ENV=test');
}

// Express 4 Async Error Handling: forward unhandled rejected promises in async route handlers to next(err)
const Layer = require('express/lib/router/layer');
const originalHandleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) {
    return originalHandleRequest.apply(this, arguments);
  }
  try {
    const result = fn(req, res, next);
    if (result && typeof result.then === 'function') {
      result.catch(next);
    }
  } catch (err) {
    next(err);
  }
};

const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const db = require('./db');
const noteSearch = require('./lib/note-search');
const pushNotifications = require('./lib/push-notifications');
const officePreview = require('./lib/office-preview');
const gamesTicket = require('./lib/games-ticket');

async function indexUploadedNote(file) {
  try {
    const status = await noteSearch.indexNote(db, file);
    try {
      const knowledgeSync = require('./lib/knowledge-sync');
      if (typeof knowledgeSync.onNoteSaved === 'function') {
        await knowledgeSync.onNoteSaved(db, file);
      }
    } catch (syncErr) {
      console.error('[Note knowledge sync failed]', file.id, syncErr.message);
    }
    require('./ai-assistant').invalidateCache(db);
    return status;
  } catch (err) {
    console.error('[Note indexing failed]', file.id, err.code || err.name);
    return { status: 'failed' };
  }
}

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const { getSupabaseConfig } = require('./lib/supabase');
const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
let supabase = null;
let broadcastChannel = null;

if (process.env.NODE_ENV !== 'test' && process.env.QA_MODE !== 'true' && supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    broadcastChannel = supabase.channel('public:chat_messages');
    broadcastChannel.subscribe();
  } catch (err) {
    console.warn('[Supabase Client Warning]:', err.message);
  }
}

async function sendBroadcast(event, payload) {
  if (!broadcastChannel) return;
  try {
    await broadcastChannel.send({
      type: 'broadcast',
      event: event,
      payload: payload
    });
  } catch (err) {
    console.error('Broadcast error:', err);
  }
}

const app = express();
const { messagingTiming, measure: measureRequest } = require('./lib/request-timing');
app.use(messagingTiming);

// --- Uploads folder setup (use /tmp on Vercel read-only serverless runtime) ---
const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (e) { }
}

function getExtensionFromMime(mime) {
  if (!mime) return '';
  const m = String(mime).toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('png')) return '.png';
  if (m.includes('gif')) return '.gif';
  if (m.includes('webp')) return '.webp';
  if (m.includes('svg')) return '.svg';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('mp4')) return '.mp4';
  if (m.includes('quicktime') || m.includes('mov')) return '.mov';
  if (m.includes('webm')) return '.webm';
  if (m.includes('zip')) return '.zip';
  if (m.includes('text/plain')) return '.txt';
  return '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext) {
      ext = getExtensionFromMime(file.mimetype);
      if (!ext && (file.mimetype === 'image' || (file.mimetype || '').startsWith('image/'))) {
        ext = '.jpg';
      }
    }
    const uniqueName = crypto.randomBytes(16).toString('hex') + (ext || '.jpg');
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB per file
});

const chatUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
  fileFilter: (req, file, cb) => {
    const m = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.txt', '.c', '.cpp', '.py', '.java', '.js', '.html', '.css', '.json'];
    if (
      m.startsWith('image') ||
      m.startsWith('video') ||
      m.startsWith('application/pdf') ||
      m.startsWith('text/') ||
      allowedExts.includes(ext) ||
      (!ext && (m === 'application/octet-stream' || !m))
    ) {
      cb(null, true);
    } else {
      cb(new Error('File format not supported. Please upload an image, video, PDF, document, or code file.'));
    }
  }
});

// Security Headers & Body Parsing
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Request duration logger (active in development or when ENABLE_TIMING_LOGS is set)
if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_TIMING_LOGS === 'true') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const rawUrl = req.originalUrl || req.url;
      const safeUrl = rawUrl.replace(/([?&])token=[^&]+/gi, '$1token=[REDACTED]');
      console.log(`[SERVER HTTP] ${req.method} ${safeUrl} ${res.statusCode} (${duration}ms)`);
    });
    next();
  });
}

app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

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

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('FATAL: SESSION_SECRET must be set in production!');
}

// Expired session cleanup interval (hourly)
const cleanupTimer = setInterval(() => {
  if (typeof db.cleanupExpiredSessions === 'function') {
    db.cleanupExpiredSessions().catch(() => {});
  }
}, 60 * 60 * 1000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

app.set('trust proxy', 1);

const sessionMiddleware = session({
  store: sessionStore,
  name: '__gu_session',
  secret: process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382',
  resave: false,
  saveUninitialized: false,
  cookie: {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days persistent session
  }
});

app.use((req, res, next) => {
  // Stateless Bearer token requests bypass session store operations to eliminate redundant DB writes.
  // Browser requests (carrying __gu_session cookie) always run sessionMiddleware.
  const hasSessionCookie = Boolean(req.headers.cookie && req.headers.cookie.includes('__gu_session'));
  const authHeader = req.headers['authorization'];
  if (
    !hasSessionCookie &&
    authHeader &&
    authHeader.startsWith('Bearer ') &&
    !req.path.startsWith('/api/auth/sync-session') &&
    !req.path.startsWith('/api/auth/register') &&
    !req.path.startsWith('/api/teacher/onboarding/finalize')
  ) {
    return next();
  }
  sessionMiddleware(req, res, next);
});

// Ensure schema is fully initialized before serving requests
let isDbReady = false;
let initDbPromise = null;
app.use(async (req, res, next) => {
  if (!isDbReady) {
    if (!initDbPromise) {
      initDbPromise = (typeof db.verifyStartupReady === 'function' ? db.verifyStartupReady() : db.initSchema())
        .then(() => {
          isDbReady = true;
        })
        .catch((err) => {
          initDbPromise = null;
          throw err;
        });
    }
    try {
      await initDbPromise;
    } catch (err) {
      return res.status(503).json({ message: 'Database initialization in progress or failed. Please retry.' });
    }
  }
  next();
});

// Unified Authentication Middleware
// Verifies Supabase Bearer JWTs for the web application,
// and preserves legacy mobile Bearer tokens for the mobile app.
const { createAuthMiddleware } = require('./lib/auth-middleware');
const auth = createAuthMiddleware(db);
app.use((req, res, next) => {
  measureRequest('auth', () => auth.authenticate(req, res, () => {})).then(() => next(), next);
});

// CSRF / Origin Guard on state-changing requests
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    // Mobile requests using Authorization: Bearer tokens are immune to browser CSRF
    if (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')) {
      return next();
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
        const originHost = originUrl.hostname.toLowerCase();
        const isAllowed = originHost === hostHeader ||
          originHost === 'localhost' ||
          originHost === '127.0.0.1' ||
          originUrl.protocol === 'capacitor:' ||
          originUrl.protocol === 'exp:' ||
          originUrl.protocol === 'file:';
        if (!isAllowed) {
          return res.status(403).json({ message: 'Cross-site request blocked.' });
        }
      } catch (e) {
        return res.status(403).json({ message: 'Invalid origin header.' });
      }
    } else if (req.headers.referer) {
      try {
        const refUrl = new URL(req.headers.referer);
        const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
        const refHost = refUrl.hostname.toLowerCase();
        const isAllowed = refHost === hostHeader ||
          refHost === 'localhost' ||
          refHost === '127.0.0.1';
        if (!isAllowed) {
          return res.status(403).json({ message: 'Cross-site request blocked.' });
        }
      } catch (e) {
        return res.status(403).json({ message: 'Invalid referer header.' });
      }
    }
  }
  next();
});

// Opportunistic expired session cleanup for serverless/Vercel (prunes without needing long-running daemon)
let requestCounter = 0;
app.use((req, res, next) => {
  requestCounter++;
  if (requestCounter % 100 === 0 && typeof db.cleanupExpiredSessions === 'function') {
    db.cleanupExpiredSessions().catch(() => {});
  }
  next();
});

// --- Shared Database-Backed Login Rate Limiter (Brute-Force Defense) ---
async function checkLoginRateLimit(ip) {
  try {
    const row = db.isPostgres
      ? await db.get('SELECT attemptCount, lockedUntil FROM login_attempts WHERE ip = $1', ip)
      : await db.get('SELECT attemptCount, lockedUntil FROM login_attempts WHERE ip = ?', ip);
    if (row && row.lockedUntil) {
      const lockedUntilTime = new Date(row.lockedUntil).getTime();
      const now = Date.now();
      if (lockedUntilTime > now) {
        return Math.ceil((lockedUntilTime - now) / 1000);
      }
    }
  } catch (err) {
    console.warn('[Login Rate Limit Check Warning]:', err.message);
  }
  return 0;
}

async function recordFailedLogin(ip) {
  try {
    const now = new Date();
    const row = db.isPostgres
      ? await db.get('SELECT attemptCount, lastAttemptAt FROM login_attempts WHERE ip = $1', ip)
      : await db.get('SELECT attemptCount, lastAttemptAt FROM login_attempts WHERE ip = ?', ip);
    let count = 1;
    if (row && row.lastAttemptAt) {
      const lastTime = new Date(row.lastAttemptAt).getTime();
      if (now.getTime() - lastTime < 15 * 60 * 1000) {
        count = (Number(row.attemptCount) || 0) + 1;
      }
    }
    let lockedUntil = null;
    if (count >= 5) {
      lockedUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    }
    const nowIso = now.toISOString();

    if (db.isPostgres) {
      await db.run(`
        INSERT INTO login_attempts (ip, attemptCount, lockedUntil, lastAttemptAt)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ip) DO UPDATE SET
          attemptCount = EXCLUDED.attemptCount,
          lockedUntil = EXCLUDED.lockedUntil,
          lastAttemptAt = EXCLUDED.lastAttemptAt
      `, ip, count, lockedUntil, nowIso);
    } else {
      await db.run(`
        INSERT INTO login_attempts (ip, attemptCount, lockedUntil, lastAttemptAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (ip) DO UPDATE SET
          attemptCount = excluded.attemptCount,
          lockedUntil = excluded.lockedUntil,
          lastAttemptAt = excluded.lastAttemptAt
      `, ip, count, lockedUntil, nowIso);
    }
  } catch (err) {
    console.error('[Record Failed Login Error]:', err.message);
  }
}

async function clearLoginAttempts(ip) {
  try {
    if (db.isPostgres) {
      await db.run('DELETE FROM login_attempts WHERE ip = $1', ip);
    } else {
      await db.run('DELETE FROM login_attempts WHERE ip = ?', ip);
    }
  } catch (err) {
    console.warn('[Clear Login Attempts Warning]:', err.message);
  }
}

async function loginRateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || 'unknown';
  const remainingSec = await checkLoginRateLimit(ip);
  if (remainingSec > 0) {
    return res.status(429).json({
      message: `Too many failed attempts. Security cooldown: ${remainingSec}s remaining.`
    });
  }
  next();
}

const chatRateLimits = new Map(); // studentId -> { count, lastReset }

function chatRateLimiter(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
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

// Clean URL Aliases for Protected and Public Pages (Static shells guarded client-side by Supabase)
app.get(['/admin-dashboard', '/admin-dashboard.html', '/admin'], async (req, res) => {
  const sessionStudentId = req.session?.studentId || req.user?.studentId;
  if (!sessionStudentId) {
    return res.redirect('/login.html');
  }
  const user = await db.get('SELECT role FROM students WHERE studentId = ?', sessionStudentId);
  if (!user || user.role !== 'admin') {
    if (user && user.role === 'teacher') {
      return res.redirect('/teacher-dashboard.html');
    }
    return res.redirect('/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get(['/admin-teachers', '/admin-teachers.html'], async (req, res) => {
  const sessionStudentId = req.session?.studentId || req.user?.studentId;
  if (!sessionStudentId) {
    return res.redirect('/login.html');
  }
  const user = await db.get('SELECT role FROM students WHERE studentId = ?', sessionStudentId);
  if (!user || user.role !== 'admin') {
    if (user && user.role === 'teacher') {
      return res.redirect('/teacher-dashboard.html');
    }
    return res.redirect('/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin-teachers.html'));
});

app.get(['/admin-cohorts', '/admin-cohorts.html'], async (req, res) => {
  const sessionStudentId = req.session?.studentId || req.user?.studentId;
  if (!sessionStudentId) {
    return res.redirect('/login.html');
  }
  const user = await db.get('SELECT role FROM students WHERE studentId = ?', sessionStudentId);
  if (!user || user.role !== 'admin') {
    if (user && user.role === 'teacher') {
      return res.redirect('/teacher-dashboard.html');
    }
    return res.redirect('/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin-cohorts.html'));
});

app.get(['/teacher-dashboard', '/teacher-dashboard.html'], async (req, res) => {
  const sessionStudentId = req.session?.studentId || req.user?.studentId;
  if (sessionStudentId) {
    const user = await db.get('SELECT role FROM students WHERE studentId = ?', sessionStudentId);
    if (user && user.role !== 'teacher' && user.role !== 'admin') {
      return res.redirect('/dashboard.html');
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'teacher-dashboard.html'));
});

app.get(['/dashboard', '/dashboard.html', '/student-dashboard', '/student-dashboard.html'], async (req, res) => {
  const sessionStudentId = req.session?.studentId || req.user?.studentId;
  if (sessionStudentId) {
    const user = await db.get('SELECT role FROM students WHERE studentId = ?', sessionStudentId);
    if (user && user.role === 'teacher') {
      return res.redirect('/teacher-dashboard.html');
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get(['/create-post', '/create-post.html', '/new-post'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'create-post.html'));
});

app.get(['/search', '/search.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

app.get('/files', (req, res) => {
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

app.get(['/attendance', '/attendance.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

app.get(['/marks-entry', '/marks-entry.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'marks-entry.html'));
});

app.get(['/results', '/results.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// Standalone Mobile App Download Page
app.get(['/download', '/download.html', '/app'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Direct APK download endpoint (serves local binary if present, else redirects to permanent download URL)
const LATEST_APK_CDN_URL = 'https://expo.dev/artifacts/eas/YbEkcxnJpoBqhhRvx629v8FchO1U2zYHqWgaO61sYtE.apk';
const GITHUB_APK_DOWNLOAD_URL = 'https://github.com/sauugat/semestar_library/releases/latest/download/semlib.apk';
const GITHUB_SEMLAB_APK_DOWNLOAD_URL = 'https://github.com/sauugat/semestar_library/releases/latest/download/semlab.apk';

app.get(['/download/apk', '/api/download/apk', '/download/semlib.apk', '/semlib.apk', '/download/semlab.apk', '/semlab.apk', '/download/Semester-library.apk'], (req, res) => {
  const isSemlab = req.path.toLowerCase().includes('semlab');
  const targetFilename = isSemlab ? 'semlab.apk' : 'semlib.apk';
  const localApkPath = path.join(__dirname, targetFilename);
  if (fs.existsSync(localApkPath)) {
    return res.download(localApkPath, targetFilename);
  }
  const fallbackApkPath = path.join(__dirname, isSemlab ? 'semlib.apk' : 'semlab.apk');
  if (fs.existsSync(fallbackApkPath)) {
    return res.download(fallbackApkPath, targetFilename);
  }
  return res.redirect(LATEST_APK_CDN_URL);
});

// App version and update check endpoint
app.get(['/api/app/version', '/api/version'], (req, res) => {
  res.json({
    version: '1.0.0',
    latestVersion: '1.0.0',
    versionCode: 7,
    apkUrl: LATEST_APK_CDN_URL,
    cdnUrl: LATEST_APK_CDN_URL,
    releaseNotes: 'Semester Library Android version 1.0.0 (build code 7) private testing release.',
    forceUpdate: false,
    phase: 'phase2a',
    postMultiImage: true,
    postEdit: true
  });
});


app.get('/semesters', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'semesters.html'));
});

app.get('/notices', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'notices.html'));
});

// Assignments / Code Lab — show subjects directly
app.get(['/assignments', '/code-lab', '/code-lab/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'code-lab', 'subjects.html'));
});

// Single assignment web route handler
app.get(['/assignments/:id', '/assignment/:id'], (req, res) => {
  const assignmentId = req.params.id;
  if (assignmentId && /^\d+$/.test(assignmentId)) {
    return res.redirect(`/code-lab/assignment.html?id=${encodeURIComponent(assignmentId)}`);
  }
  res.redirect('/code-lab/subjects.html');
});

// Single post web route handler
app.get(['/posts/:id', '/post/:id'], (req, res) => {
  const postId = req.params.id;
  if (postId && /^\d+$/.test(postId)) {
    return res.redirect(`/dashboard.html?post=${encodeURIComponent(postId)}`);
  }
  res.redirect('/dashboard.html');
});

app.get('/code-lab/compiler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'code-lab', 'index.html'));
});

app.get('/semester/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'semester.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get(['/chatbot', '/assistant'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

app.get('/compiler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compiler.html'));
});

app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get(['/register', '/register.html'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get(['/reset-password', '/reset-password.html', '/forgot-password'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get(['/terms', '/termsandconditions'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'termsandconditions.html'));
});

app.get(['/delete-account', '/delete-account.html', '/account-deletion'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'delete-account.html'));
});


// Google Search Console Site Verification Protection
app.get('/google:hash.html', (req, res, next) => {
  const file = `google${req.params.hash}.html`;
  const filePath = path.join(__dirname, 'public', file);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(filePath);
  }
  next();
});

// Explicit SEO routes for search console submissions and crawlers
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Serve persistent post images on every instance, including fresh Vercel functions.
app.use('/uploads/posts', require('./routes/post-images')(db));

// Serve shared auth and academic-context modules without stale browser caching
app.get(['/js/auth.js', '/auth.js'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public/auth.js'));
});

app.get('/academic-context.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public/academic-context.js'));
});

// Serve static assets securely with long-lived cache headers for versioned assets and public JSON
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const postUploads = path.join(__dirname, 'public', 'uploads', 'posts') + path.sep;
    if (filePath.startsWith(postUploads)) {
      res.setHeader('Content-Disposition', 'inline');
      if (!filePath.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      }
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return;
    }
    const lower = filePath.toLowerCase();
    if (lower.endsWith('syllabus-data.json')) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    } else if (lower.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (/\.(css|js|woff2?|ttf|otf|webp|png|jpe?g|gif|svg|ico)$/.test(lower)) {
      const base = path.basename(lower);
      if (
        base === 'sw.js' ||
        base === 'swr.js' ||
        base === 'auth.js' ||
        base === 'auth-modal.js' ||
        base === 'academic-context.js' ||
        base === 'teacher-attendance.js' ||
        base === 'student-attendance.js' ||
        base === 'attendance-drive-sync.js' ||
        base === 'teacher-marks-entry.js' ||
        base === 'student-results.js'
      ) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }
}));

function requireLogin(req, res, next) {
  if (req.isSuspended) {
    return res.status(403).json({
      error: 'ACCOUNT_SUSPENDED',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account has been suspended by an administrator. Please contact support.'
    });
  }
  if (req.user && req.user.studentId) {
    if (req.user.account_status === 'suspended' || req.user.accountStatus === 'suspended') {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }
    req.student = req.user;
    if (!req.session) req.session = {};
    req.session.studentId = req.user.studentId;
    req.session.role = req.user.role || 'student';
    return next();
  }
  if (req.session && req.session.studentId) {
    db.get('SELECT studentId, role, name, department, semester, cohort_id, email, avatarUrl, account_status FROM students WHERE studentId = ?', req.session.studentId)
      .then(student => {
        if (!student) {
          if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
          if (res.clearCookie) res.clearCookie('__gu_session');
          return res.status(401).json({ message: 'Authentication required. Account not found.' });
        }
        if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
          if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
          if (res.clearCookie) res.clearCookie('__gu_session');
          return res.status(403).json({
            error: 'ACCOUNT_SUSPENDED',
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended by an administrator. Please contact support.'
          });
        }
        req.user = student;
        req.student = student;
        req.session.role = student.role || 'student';
        next();
      })
      .catch(next);
    return;
  }
  return res.status(401).json({ message: 'Authentication required. Please sign in.' });
}
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    phase: 'phase2b',
    postMultiImage: true,
    postEdit: true,
    modernComments: true,
    server: 'Semester Library',
    time: new Date().toISOString()
  });
});

// Server-Authoritative Academic Context
const {
  getAcademicContext,
  buildAcademicContentFilter,
  resolvePublishScope,
  assertContentAccess,
  resolveActiveCohortForSemester,
  logCohortAudit,
  parseSemesterNumber
} = require('./lib/academic-context');
app.get('/api/academic-context', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    res.json(context);
  } catch (err) {
    console.error('[Academic Context API Error]:', err);
    res.status(500).json({ message: 'Could not load academic context.' });
  }
});

const postsRouterInstance = require('./routes/posts')(db, requireLogin);
app.use('/api/posts', postsRouterInstance);
app.get('/api/profile/:studentId/posts', requireLogin, (req, res, next) => {
  req.query.studentId = req.params.studentId;
  req.url = '/';
  postsRouterInstance(req, res, next);
});
app.use('/api/comments', require('./routes/comments')(db, requireLogin));
app.use('/api/admin', require('./routes/admin-dashboard')(db, requireLogin));
app.use('/api/admin', require('./routes/admin-teachers')(db, requireLogin));
app.use('/api/admin', require('./routes/admin-cohorts')(db, requireLogin));
app.use('/api/attendance', require('./routes/attendance')(db, requireLogin));
app.use('/api/admin/attendance', require('./routes/attendance')(db, requireLogin));
app.use('/api/marks', require('./routes/marks')(db, requireLogin));
app.use('/api/results', require('./routes/marks')(db, requireLogin));
app.use('/api/admin/marks', require('./routes/marks')(db, requireLogin));
app.use('/api/teacher/onboarding', require('./routes/teacher-onboarding'));

// Direct Messaging Router (Feature flag DM_ENABLED or controlled tester allowlist DM_TEST_USER_IDS)
const { isDmEnabled, isDmAllowedForUser, getDmTestUserIds } = require('./lib/dm-config');
app.get('/api/dm-status', (req, res) => {
  // Canonical identity strictly from authenticated mobile bearer token (req.user/student) or website session (req.session)
  const callerId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
  res.json({ enabled: isDmAllowedForUser(callerId) });
});
if (isDmEnabled() || getDmTestUserIds().length > 0) {
  const dmService = require('./lib/dm-service').createDmService(db);
  app.use('/api/dm', requireLogin, require('./routes/direct-messaging')(dmService));

  // Background worker to periodically drain pending DM Realtime and Push outbox events
  if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    const dmWorkerInterval = setInterval(() => {
      dmService.drain().catch(() => {});
    }, 2000);
    dmWorkerInterval.unref?.();
  }
}

// --- Code Lab Rate Limiting ---
const rateLimit = require('express-rate-limit');

const eventsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,              // generous — normal flushing is every 10s, so ~6/min expected
  message: { message: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/code-lab/events', eventsLimiter);

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // a student submitting more than 10 times a minute is not normal use
  message: { message: 'Too many submission attempts, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/code-lab/submissions', submitLimiter);
app.use('/api/code-lab/questions/:questionId/submissions', submitLimiter);

const explainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // prevent spam-clicking the AI explain button
  message: { message: 'Too many explain requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/code-lab/explain-error', explainLimiter);

app.use('/api/code-lab', require('./routes/code-lab/assignments'));
// --- Code Lab (isolated module) ---
app.use('/api/code-lab', require('./routes/code-lab/run'));
app.use('/api/code-lab', require('./routes/code-lab/explain'));

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
    await recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
    return res.status(403).json({
      error: 'ACCOUNT_SUSPENDED',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account has been suspended by an administrator. Please contact support.'
    });
  }

  const match = bcrypt.compareSync(password, student.passwordHash);

  if (!match) {
    await recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  // Clear failed attempt record upon successful authentication
  await clearLoginAttempts(ip);

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
      const dest = student.role === 'admin'
        ? '/admin-dashboard.html'
        : (student.role === 'teacher' ? '/teacher-dashboard.html' : '/dashboard.html');
      return res.json({ message: 'Login successful', redirect: dest });
    });
  });
});

app.post('/api/mobile/login', loginRateLimiter, async (req, res) => {
  const identifier = (req.body.identifier || req.body.studentId || req.body.username || req.body.email || '').trim();
  const password = req.body.password || '';
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Username/email/student ID and password are required.' });
  }

  let student = null;
  if (identifier.includes('@')) {
    student = await db.get('SELECT * FROM students WHERE LOWER(email) = ?', identifier.toLowerCase());
  } else {
    student = await db.get(
      'SELECT * FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?',
      identifier.toLowerCase(), identifier.toLowerCase()
    );
  }

  if (!student) {
    // Check if this is a pending teacher account whose email was verified
    try {
      const pendingTeacher = await db.get(
        'SELECT * FROM teacher_onboarding_pending WHERE LOWER(username) = ? OR LOWER(email) = ?',
        identifier.toLowerCase(), identifier.toLowerCase()
      );
      if (pendingTeacher && pendingTeacher.email) {
        const { authenticateWithPassword } = require('./lib/supabase');
        const { data: sbData, error: sbErr } = await authenticateWithPassword({
          email: pendingTeacher.email.toLowerCase(),
          password
        });
        if (sbErr) {
          const errLower = (sbErr.message || '').toLowerCase();
          if (errLower.includes('email not confirmed') || errLower.includes('not confirmed')) {
            return res.status(403).json({
              code: 'EMAIL_NOT_CONFIRMED',
              message: 'Your email address has not been verified yet. Please check your inbox and verify your email before signing in.'
            });
          }
        } else if (sbData && sbData.user) {
          const { finalizeTeacherOnboarding } = require('./lib/teacher-service');
          const finRes = await finalizeTeacherOnboarding(db, {
            supabaseToken: sbData.session?.access_token,
            supabaseUser: sbData.user
          });
          if (finRes && finRes.success) {
            student = await db.get('SELECT * FROM students WHERE studentId = ?', finRes.teacherId);
          }
        }
      }
    } catch (_) {}
  }

  if (!student) {
    try {
      const { isTeacherOnboardingEnabled, verifyTemporaryTeacherCredentials, signOnboardingToken } = require('./lib/teacher-service');
      if (isTeacherOnboardingEnabled()) {
        const tempCheck = await verifyTemporaryTeacherCredentials(db, { username: identifier, password });
        if (tempCheck && tempCheck.success) {
          const invite = tempCheck.invite;
          const tokenData = signOnboardingToken({
            inviteId: invite.id,
            initialUsername: invite.initial_username || invite.initialusername,
            nonce: invite.onboarding_nonce || invite.onboardingnonce || 1
          });
          return res.json({
            onboardingRequired: true,
            onboardingToken: tokenData.token,
            expiresAt: tokenData.expiresAt,
            state: {
              initialUsername: invite.initial_username || invite.initialusername,
              status: invite.status,
              expiresAt: invite.expires_at || invite.expiresat
            }
          });
        }
      }
    } catch (_) {}

    await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 40)));
    await recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid username/email or password.' });
  }

  if (student.account_status === 'suspended' || student.accountStatus === 'suspended') {
    return res.status(403).json({
      error: 'ACCOUNT_SUSPENDED',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account has been suspended by an administrator. Please contact support.'
    });
  }

  let authenticated = false;

  // 1. Try Supabase Auth if user has an email and Supabase credentials exist
  if (student.email) {
    try {
      const { authenticateWithPassword } = require('./lib/supabase');
      const { data, error } = await authenticateWithPassword({
        email: student.email.toLowerCase(),
        password: password,
      });

      if (error) {
        const errLower = (error.message || '').toLowerCase();
        if (errLower.includes('email not confirmed') || errLower.includes('not confirmed')) {
          return res.status(403).json({
            code: 'EMAIL_NOT_CONFIRMED',
            message: 'Your email address has not been verified yet. Please check your inbox and verify your email before signing in.'
          });
        }
      } else if (data && data.user) {
        authenticated = true;
        // Synchronize supabase_uid and verification_status to database
        if (student.studentId) {
          const sid = student.studentId;
          const suid = data.user.id;
          if (!student.supabase_uid || student.verification_status !== 'verified') {
            db.run('UPDATE students SET supabase_uid = ?, verification_status = ? WHERE studentId = ?', suid, 'verified', sid).catch(() => {});
            student.supabase_uid = suid;
            student.verification_status = 'verified';
          }
        }
      }
    } catch (supabaseErr) {
      // Ignore and try fallback to local passwordHash
    }
  }

  // 2. If not authenticated via Supabase, fall back to bcrypt local passwordHash
  if (!authenticated && student.passwordHash && student.passwordHash !== 'supabase_auth') {
    if (bcrypt.compareSync(password, student.passwordHash)) {
      authenticated = true;
    }
  }

  if (!authenticated) {
    await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 40)));
    await recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid username/email or password.' });
  }

  await clearLoginAttempts(ip);

  // Generate an opaque random 64-hex token (not JWT)
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const createdAt = now.toISOString();
  // 30 days token expiry
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    'INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
    token, student.studentId, createdAt, expiresAt
  );

  const profile = await getStudentProfile(student.studentId, student.studentId);

  return res.json({
    token,
    user: {
      studentId: student.studentId,
      username: student.username || null,
      name: student.name,
      role: student.role || 'student',
      department: student.department || 'BIT',
      semester: student.semester || 'Semester 1',
      gender: student.gender || null,
      email: student.email || null,
      avatarUrl: student.avatarUrl || null,
      bio: student.bio || '',
      githubUrl: student.githubUrl || '',
      linkedinUrl: student.linkedinUrl || '',
      verificationStatus: student.verification_status || student.verificationStatus || 'unverified',
      isAdmin: (student.role === 'admin'),
      isCR: (student.role === 'cr' || student.role === 'class_rep'),
      stats: profile?.stats || { filesCount: 0, likesReceived: 0, followersCount: 0, followingCount: 0 }
    }
  });
});

// Public Supabase configuration for client
app.get('/api/auth/config', (req, res) => {
  const { url, key } = require('./lib/supabase').getSupabaseConfig();
  res.json({ url, key });
});

// Check availability for email and username during student registration
app.all(['/api/auth/check-availability', '/api/auth/signup/check'], loginRateLimiter, async (req, res) => {
  const email = (req.method === 'POST' ? req.body.email : req.query.email) || '';
  const username = (req.method === 'POST' ? req.body.username : req.query.username) || '';

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanUsername = String(username).trim().toLowerCase();

  if (cleanEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail) || cleanEmail.length > 150) {
      return res.status(400).json({ available: false, field: 'email', message: 'Please provide a valid email address.' });
    }
    const existingEmail = await db.get('SELECT studentId FROM students WHERE LOWER(email) = ?', cleanEmail);
    if (existingEmail) {
      return res.status(400).json({
        available: false,
        field: 'email',
        code: 'EMAIL_EXISTS',
        message: 'An account with this email address already exists. Log in instead.'
      });
    }
  }

  if (cleanUsername) {
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({
        available: false,
        field: 'username',
        message: 'Username must be 3-30 characters (letters, numbers, underscore, dot).'
      });
    }
    const existingUser = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', cleanUsername);
    if (existingUser) {
      return res.status(400).json({
        available: false,
        field: 'username',
        code: 'USERNAME_TAKEN',
        message: 'This username is already taken. Please choose another.'
      });
    }
  }

  return res.json({ available: true, message: 'Available for registration.' });
});

// Student Self-Registration (Supports verified Supabase OTP finalization and legacy password flow)
app.post(['/api/auth/register', '/api/auth/finalize-signup'], loginRateLimiter, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const supabaseBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.body && req.body.supabaseToken ? String(req.body.supabaseToken).trim() : '');

  // VERIFIED OTP STUDENT FINALIZATION BRANCH
  if (supabaseBearer) {
    const { verifySupabaseToken } = require('./lib/supabase');
    const { user: authUser, error: tokenErr } = await verifySupabaseToken(supabaseBearer);
    if (tokenErr || !authUser || !authUser.id) {
      return res.status(401).json({ message: 'Invalid or expired authentication session. Please verify your email again.' });
    }

    const isConfirmed = !!(authUser.email_confirmed_at || authUser.confirmed_at);
    if (!isConfirmed) {
      return res.status(400).json({ message: 'Email must be verified before completing registration.' });
    }

    const cleanName = String(req.body.fullName || req.body.name || '').trim();
    const cleanUsername = String(req.body.username || '').trim().toLowerCase();
    const cleanEmail = String(req.body.email || authUser.email || '').trim().toLowerCase();
    const cleanDept = String(req.body.department || 'BIT').trim();
    const cleanSem = String(req.body.semester || 'Semester 1').trim();
    const cleanGender = req.body.gender && String(req.body.gender).trim() ? String(req.body.gender).trim().toLowerCase() : null;

    if (!cleanName || !cleanUsername || !cleanEmail || !cleanSem) {
      return res.status(400).json({ message: 'Full Name, Username, Email, and Semester are required.' });
    }

    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({ message: 'Full name must be between 2 and 100 characters.' });
    }
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ message: 'Username must be 3-30 characters (letters, numbers, underscore, dot).' });
    }
    if (authUser.email && cleanEmail !== authUser.email.toLowerCase().trim()) {
      return res.status(400).json({ message: 'Verified email does not match registration email.' });
    }

    const validSemesters = ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'];
    if (!validSemesters.includes(cleanSem)) {
      return res.status(400).json({ message: 'Please select a valid semester (Semester 1 through 8).' });
    }
    const semNum = parseSemesterNumber(cleanSem);
    if (!semNum) {
      return res.status(400).json({ message: 'Please select a valid semester (Semester 1 through 8).' });
    }
    if (cleanGender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(cleanGender)) {
      return res.status(400).json({ message: 'Invalid gender selection.' });
    }

    // Check if student with this Supabase UID already exists (idempotent retry)
    const existingStudentByUid = await db.get('SELECT * FROM students WHERE supabase_uid = ?', authUser.id);
    if (existingStudentByUid) {
      const mobileToken = crypto.randomBytes(32).toString('hex');
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', mobileToken, existingStudentByUid.studentId, createdAt, expiresAt);
      if (req.session) {
        req.session.studentId = existingStudentByUid.studentId;
        req.session.studentName = existingStudentByUid.name;
        req.session.role = existingStudentByUid.role || 'student';
      }
      return res.status(200).json({
        success: true,
        message: 'Account already finalized.',
        user: {
          studentId: existingStudentByUid.studentId,
          username: existingStudentByUid.username,
          name: existingStudentByUid.name,
          email: existingStudentByUid.email,
          role: existingStudentByUid.role,
          department: existingStudentByUid.department,
          semester: existingStudentByUid.semester,
          gender: existingStudentByUid.gender,
          cohortId: existingStudentByUid.cohort_id,
          verificationStatus: 'verified'
        },
        mobileToken,
        token: mobileToken
      });
    }

    // Check for username and email uniqueness
    const existingUser = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', cleanUsername);
    if (existingUser) {
      return res.status(400).json({ message: 'This username is already taken. Please choose another.' });
    }
    const existingEmail = await db.get('SELECT studentId FROM students WHERE LOWER(email) = ?', cleanEmail);
    if (existingEmail) {
      return res.status(400).json({ message: 'An account with this email address already exists. Log in instead.' });
    }

    // Authoritative cohort resolution (assigns active cohort if one matches, or keeps semester with unassigned cohort)
    const cohortResolution = await resolveActiveCohortForSemester(db, semNum);
    const assignedCohort = (cohortResolution && cohortResolution.cohort && cohortResolution.cohort.id) ? cohortResolution.cohort : null;
    const assignedCohortId = assignedCohort ? assignedCohort.id : null;

    let studentIdToUse = String(req.body.studentId || cleanUsername).trim();
    const existingId = await db.get('SELECT studentId FROM students WHERE studentId = ?', studentIdToUse);
    if (existingId) {
      studentIdToUse = `s_${cleanUsername}_${crypto.randomBytes(3).toString('hex')}`;
    }

    if (db.isPostgres) {
      await db.run(
        `INSERT INTO students (
          studentId, username, name, email, supabase_uid,
          department, semester, gender, role, verification_status,
          passwordHash, cohort_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'student', 'verified', 'supabase_auth', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        studentIdToUse, cleanUsername, cleanName, cleanEmail, authUser.id,
        cleanDept, cleanSem, cleanGender, assignedCohortId
      );
    } else {
      await db.run(
        `INSERT INTO students (
          studentId, username, name, email, supabase_uid,
          department, semester, gender, role, verification_status,
          passwordHash, cohort_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'verified', 'supabase_auth', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        studentIdToUse, cleanUsername, cleanName, cleanEmail, authUser.id,
        cleanDept, cleanSem, cleanGender, assignedCohortId
      );
    }

    if (assignedCohortId && assignedCohort) {
      await logCohortAudit(db, {
        action: 'signup_auto_assign',
        cohortId: assignedCohortId,
        actorId: studentIdToUse,
        details: {
          semester: cleanSem,
          semesterNo: semNum,
          slotCode: assignedCohort.slotCode,
          displayName: assignedCohort.displayName,
          currentSemester: assignedCohort.currentSemester
        }
      });
    }

    if (req.session) {
      req.session.studentId = studentIdToUse;
      req.session.studentName = cleanName;
      req.session.role = 'student';
    }

    const mobileToken = crypto.randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', mobileToken, studentIdToUse, createdAt, expiresAt);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: {
        studentId: studentIdToUse,
        username: cleanUsername,
        name: cleanName,
        email: cleanEmail,
        role: 'student',
        department: cleanDept,
        semester: cleanSem,
        gender: cleanGender,
        cohortId: assignedCohortId,
        verificationStatus: 'verified'
      },
      mobileToken,
      token: mobileToken
    });
  }
  const {
    fullName,
    studentId,
    username,
    email,
    department,
    semester,
    gender,
    password,
    confirmPassword
  } = req.body || {};

  // 1. Validate required fields
  if (!fullName || !studentId || !username || !email || !department || !semester || !password || !confirmPassword) {
    return res.status(400).json({ message: 'All required fields must be provided.' });
  }

  const cleanName = String(fullName).trim();
  const cleanStudentId = String(studentId).trim();
  const cleanUsername = String(username).trim().toLowerCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanDept = String(department).trim();
  const cleanSem = String(semester).trim();
  const cleanGender = gender && String(gender).trim() ? String(gender).trim().toLowerCase() : null;
  const pass = String(password);
  const confirmPass = String(confirmPassword);

  // 2. Validate field formats and lengths
  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ message: 'Full name must be between 2 and 100 characters.' });
  }
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(cleanStudentId)) {
    return res.status(400).json({ message: 'Student ID must be 3-30 alphanumeric characters.' });
  }
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(cleanUsername)) {
    return res.status(400).json({ message: 'Username must be 3-30 characters (letters, numbers, underscore, dot).' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail) || cleanEmail.length > 150) {
    return res.status(400).json({ message: 'Please provide a valid email address.' });
  }
  if (cleanDept.length < 2 || cleanDept.length > 50) {
    return res.status(400).json({ message: 'Please select a valid department.' });
  }
  const validSemesters = ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5', 'Semester 6', 'Semester 7', 'Semester 8'];
  if (!validSemesters.includes(cleanSem)) {
    return res.status(400).json({ message: 'Please select a valid semester (Semester 1 through 8).' });
  }
  const semNum = parseSemesterNumber(cleanSem);
  if (!semNum) {
    return res.status(400).json({ message: 'Please select a valid semester (Semester 1 through 8).' });
  }

  if (cleanGender && !['male', 'female', 'other', 'prefer_not_to_say'].includes(cleanGender)) {
    return res.status(400).json({ message: 'Invalid gender selection.' });
  }
  if (pass.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  }
  if (pass !== confirmPass) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  // 3. Check for duplicates in Neon
  const existingStudentId = await db.get('SELECT studentId FROM students WHERE studentId = ?', cleanStudentId);
  if (existingStudentId) {
    return res.status(400).json({ message: 'A student with this Student ID is already registered.' });
  }

  const existingUsername = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', cleanUsername);
  if (existingUsername) {
    return res.status(400).json({ message: 'This username is already taken. Please choose another.' });
  }

  const existingEmail = await db.get('SELECT studentId FROM students WHERE LOWER(email) = ?', cleanEmail);
  if (existingEmail) {
    return res.status(400).json({ message: 'An account with this email address already exists.' });
  }

  // Authoritative cohort resolution (client-provided cohort_id is strictly ignored)
  const cohortResolution = await resolveActiveCohortForSemester(db, semNum);
  const assignedCohort = (cohortResolution && cohortResolution.cohort && cohortResolution.cohort.id) ? cohortResolution.cohort : null;
  const assignedCohortId = assignedCohort ? assignedCohort.id : null;

  // Resolve verification redirect URL
  const appBaseUrl = process.env.APP_URL || process.env.SITE_URL;
  let origin = req.headers.origin || (appBaseUrl ? appBaseUrl.replace(/\/$/, '') : '');
  if (!origin && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || (req.headers.host.includes('localhost') ? 'http' : 'https');
    origin = `${proto}://${req.headers.host}`;
  }
  if (!origin) {
    origin = 'https://semestar-library.vercel.app';
  }
  const redirectUrl = `${origin}/login.html?verified=true`;

  // 4. Create user in Supabase Auth (email_confirm: false)
  let supabaseUid = null;
  const { registerSupabaseUser, getSupabaseAdminClient } = require('./lib/supabase');

  try {
    const { user: authUser, error: authErr } = await registerSupabaseUser({
      email: cleanEmail,
      password: pass,
      metadata: {
        studentId: cleanStudentId,
        username: cleanUsername,
        name: cleanName,
        department: cleanDept,
        semester: cleanSem,
      },
      redirectTo: redirectUrl,
    });

    if (authErr) {
      if (authErr.message && authErr.message.toLowerCase().includes('already registered')) {
        return res.status(400).json({ message: 'An account with this email address already exists in authentication system.' });
      }
      return res.status(400).json({ message: authErr.message || 'Failed to create authentication account.' });
    }

    if (!authUser || !authUser.id) {
      return res.status(500).json({ message: 'Failed to obtain authentication identity.' });
    }

    supabaseUid = authUser.id;
  } catch (authCreateErr) {
    console.error('[Registration Supabase Error]:', authCreateErr.message);
    return res.status(500).json({ message: 'Authentication service unavailable. Please try again later.' });
  }

  // 5. Insert student record into Neon PostgreSQL
  try {
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO students (
          studentId, username, name, email, supabase_uid,
          department, semester, gender, role, verification_status,
          passwordHash, cohort_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'student', 'unverified', 'supabase_auth', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        cleanStudentId, cleanUsername, cleanName, cleanEmail, supabaseUid,
        cleanDept, cleanSem, cleanGender, assignedCohortId
      );
    } else {
      await db.run(
        `INSERT INTO students (
          studentId, username, name, email, supabase_uid,
          department, semester, gender, role, verification_status,
          passwordHash, cohort_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'unverified', 'supabase_auth', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        cleanStudentId, cleanUsername, cleanName, cleanEmail, supabaseUid,
        cleanDept, cleanSem, cleanGender, assignedCohortId
      );
    }

    if (assignedCohortId && assignedCohort) {
      await logCohortAudit(db, {
        action: 'signup_auto_assign',
        cohortId: assignedCohortId,
        actorId: cleanStudentId,
        details: {
          semester: cleanSem,
          semesterNo: semNum,
          slotCode: assignedCohort.slotCode,
          displayName: assignedCohort.displayName,
          currentSemester: assignedCohort.currentSemester
        }
      });
    }
  } catch (dbInsertErr) {
    console.error('[Registration DB Insert Error]:', dbInsertErr.message);
    // Rollback orphaned Supabase Auth user if DB insertion failed
    try {
      const admin = getSupabaseAdminClient();
      await admin.auth.admin.deleteUser(supabaseUid);
    } catch (delErr) {
      console.warn('[Orphaned User Cleanup Warning]:', delErr.message);
    }
    return res.status(500).json({ message: 'Failed to save student profile. Please try again.' });
  }

  return res.status(201).json({
    success: true,
    message: 'Account created! A confirmation email has been sent. Please verify your email before logging in.',
    cohortId: assignedCohortId,
    academicContext: {
      role: 'student',
      academicStatus: assignedCohort ? 'active' : 'unassigned',
      semester: cleanSem,
      currentSemester: semNum,
      cohort: assignedCohort ? {
        id: assignedCohort.id,
        displayName: assignedCohort.displayName,
        currentSemester: assignedCohort.currentSemester,
        slotCode: assignedCohort.slotCode
      } : null
    }
  });
});

// Username or Email Login (Server-Side Username Resolution & Rate Limiting)
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const identifier = (req.body.identifier || req.body.email || req.body.username || '').trim();
  const password = req.body.password || '';
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Username/email and password are required.' });
  }

  let resolvedEmail = null;

  if (identifier.includes('@')) {
    resolvedEmail = identifier.toLowerCase();
  } else {
    // Resolve username or student ID to email server-side
    let student = await db.get(
      'SELECT email FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?',
      identifier.toLowerCase(), identifier.toLowerCase()
    );
    if (!student || !student.email) {
      try {
        const pendingByUsername = await db.get(
          'SELECT email FROM teacher_onboarding_pending WHERE LOWER(username) = ?',
          identifier.toLowerCase()
        );
        if (pendingByUsername && pendingByUsername.email) {
          student = { email: pendingByUsername.email };
        }
      } catch (_) {}
    }
    if (student && student.email) {
      resolvedEmail = student.email.toLowerCase();
    } else {
      try {
        const { isTeacherOnboardingEnabled, verifyTemporaryTeacherCredentials, signOnboardingToken } = require('./lib/teacher-service');
        if (isTeacherOnboardingEnabled()) {
          const tempCheck = await verifyTemporaryTeacherCredentials(db, { username: identifier, password });
          if (tempCheck && tempCheck.success) {
            const invite = tempCheck.invite;
            const tokenData = signOnboardingToken({
              inviteId: invite.id,
              initialUsername: invite.initial_username || invite.initialusername,
              nonce: invite.onboarding_nonce || invite.onboardingnonce || 1
            });
            return res.json({
              onboardingRequired: true,
              onboardingToken: tokenData.token,
              expiresAt: tokenData.expiresAt,
              state: {
                initialUsername: invite.initial_username || invite.initialusername,
                status: invite.status,
                expiresAt: invite.expires_at || invite.expiresat
              }
            });
          }
        }
      } catch (_) {}

      // Resistance against timing attacks & enumeration: execute dummy delay
      await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 40)));
      await recordFailedLogin(ip);
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }
  }

  // Authenticate through Supabase
  const { authenticateWithPassword } = require('./lib/supabase');
  try {
    const { data, error } = await authenticateWithPassword({
      email: resolvedEmail,
      password: password,
    });

    if (error) {
      const errLower = (error.message || '').toLowerCase();
      if (errLower.includes('email not confirmed') || errLower.includes('not confirmed')) {
        return res.status(403).json({
          code: 'EMAIL_NOT_CONFIRMED',
          message: 'Your email address has not been verified yet. Please check your inbox and verify your email before signing in.'
        });
      }

      await recordFailedLogin(ip);
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }

    if (!data || !data.session || !data.user) {
      await recordFailedLogin(ip);
      return res.status(401).json({ message: 'Invalid username/email or password.' });
    }

    // Login successful
    await clearLoginAttempts(ip);

    // Check if this confirmed user has a pending teacher onboarding record to finalize
    try {
      const pendingTeacher = await db.get(
        'SELECT id FROM teacher_onboarding_pending WHERE supabase_uid = ? OR LOWER(email) = ?',
        data.user.id, resolvedEmail
      );
      if (pendingTeacher) {
        const { finalizeTeacherOnboarding } = require('./lib/teacher-service');
        await finalizeTeacherOnboarding(db, {
          supabaseToken: data.session.access_token,
          supabaseUser: data.user
        });
      }
    } catch (_) {}

    // Fetch authoritative Neon student profile
    let student = await db.get(
      `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, avatarUrl, verification_status, account_status
       FROM students
       WHERE supabase_uid = ? OR (email IS NOT NULL AND LOWER(email) = ?)`,
      data.user.id, resolvedEmail
    );

    const meta = data.user.user_metadata || {};
    const isTeacherRoleMeta = String(meta.role || '').toLowerCase() === 'teacher';
    if (!student && !isTeacherRoleMeta) {
      // Auto-provision student row if Supabase account exists without a local student row
      try {
        const cleanName = String(meta.full_name || meta.name || resolvedEmail.split('@')[0] || 'Student').trim() || 'Student';
        let baseUsername = String(meta.username || meta.studentId || meta.student_id || resolvedEmail.split('@')[0].replace(/[^a-zA-Z0-9_.]/g, '') || `user_${data.user.id.slice(0, 8)}`).trim().toLowerCase();
        if (baseUsername.length < 3) baseUsername = `user_${data.user.id.slice(0, 8)}`.toLowerCase();
        let cleanUsername = baseUsername;
        const existingUsername = await db.get('SELECT studentId FROM students WHERE LOWER(username) = ?', cleanUsername);
        if (existingUsername) {
          cleanUsername = `${baseUsername.slice(0, 22)}_${crypto.randomBytes(2).toString('hex')}`;
        }
        let studentIdToUse = String(meta.studentId || meta.student_id || cleanUsername).trim();
        const existingId = await db.get('SELECT studentId FROM students WHERE studentId = ?', studentIdToUse);
        if (existingId) {
          studentIdToUse = `s_${cleanUsername}_${crypto.randomBytes(3).toString('hex')}`;
        }
        const cleanDept = String(meta.department || 'BIT').trim() || 'BIT';
        const semNum = parseSemesterNumber(meta.semester) || 1;
        const cleanSem = `Semester ${semNum}`;
        const cleanGender = meta.gender && String(meta.gender).trim() ? String(meta.gender).trim().toLowerCase() : null;
        let assignedCohortId = null;
        try {
          const cohortRes = await resolveActiveCohortForSemester(db, semNum);
          if (cohortRes && cohortRes.cohort && cohortRes.cohort.id) {
            assignedCohortId = cohortRes.cohort.id;
          }
        } catch {}

        if (db.isPostgres) {
          await db.run(
            `INSERT INTO students (
              studentId, username, name, email, supabase_uid,
              department, semester, gender, role, verification_status,
              passwordHash, cohort_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'student', 'verified', 'supabase_auth', $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            studentIdToUse, cleanUsername, cleanName, resolvedEmail, data.user.id,
            cleanDept, cleanSem, cleanGender, assignedCohortId
          );
        } else {
          await db.run(
            `INSERT INTO students (
              studentId, username, name, email, supabase_uid,
              department, semester, gender, role, verification_status,
              passwordHash, cohort_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'verified', 'supabase_auth', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            studentIdToUse, cleanUsername, cleanName, resolvedEmail, data.user.id,
            cleanDept, cleanSem, cleanGender, assignedCohortId
          );
        }

        student = await db.get(
          `SELECT studentId, username, name, role, department, semester, cohort_id, gender, email, avatarUrl, verification_status, account_status
           FROM students WHERE studentId = ?`,
          studentIdToUse
        );
      } catch (provErr) {
        console.warn('[Login Auto-Provision Warning]:', provErr.message);
      }
    }

    if (student && (student.account_status === 'suspended' || student.accountStatus === 'suspended')) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended by an administrator. Please contact support.'
      });
    }

    if (student && student.studentId) {
      const suid = data.user.id;
      const sid = student.studentId;
      if (!student.supabase_uid || (student.verification_status !== 'verified' && student.verificationStatus !== 'verified')) {
        db.run('UPDATE students SET supabase_uid = ?, verification_status = ? WHERE studentId = ?', suid, 'verified', sid).catch(() => {});
        student.supabase_uid = suid;
        student.verification_status = 'verified';
        student.verificationStatus = 'verified';
      }

      if (student.role !== 'teacher' && student.role !== 'admin' && !(student.cohort_id || student.cohortId) && student.semester) {
        try {
          const cohortRes = await resolveActiveCohortForSemester(db, student.semester);
          if (cohortRes && cohortRes.cohort && cohortRes.cohort.id) {
            student.cohort_id = cohortRes.cohort.id;
            student.cohortId = cohortRes.cohort.id;
            db.run('UPDATE students SET cohort_id = ? WHERE studentId = ?', cohortRes.cohort.id, sid).catch(() => {});
          }
        } catch {}
      }

      if (req.session) {
        req.session.studentId = student.studentId;
        req.session.studentName = student.name;
        req.session.role = student.role || 'student';
        await new Promise(resolve => {
          if (typeof req.session.save === 'function') {
            req.session.save(resolve);
          } else {
            resolve();
          }
        });
      }
    }

    const fallbackSemNum = parseSemesterNumber(student?.semester || meta.semester) || 1;
    return res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in,
      },
      user: {
        studentId: student?.studentId || meta.username || meta.studentId || data.user.id,
        username: student?.username || meta.username || null,
        name: student?.name || meta.full_name || meta.name || resolvedEmail.split('@')[0] || '',
        role: student?.role || 'student',
        department: student?.department || meta.department || 'BIT',
        semester: (student?.role === 'teacher') ? null : (student?.semester || `Semester ${fallbackSemNum}`),
        cohortId: student?.cohort_id || student?.cohortId || null,
        gender: student?.gender || meta.gender || null,
        email: student?.email || resolvedEmail,
        verificationStatus: 'verified',
      }
    });
  } catch (loginErr) {
    console.error('[Login Error]:', loginErr.message);
    await recordFailedLogin(ip);
    return res.status(500).json({ message: 'Authentication service temporarily unavailable.' });
  }
});

// Password Recovery (Enumeration-Resistant)
app.post('/api/auth/forgot-password', loginRateLimiter, async (req, res) => {
  const identifier = (req.body.identifier || req.body.email || req.body.username || '').trim();

  if (!identifier) {
    return res.status(400).json({ message: 'Please provide your username or email address.' });
  }

  let emailToSend = null;
  if (identifier.includes('@')) {
    emailToSend = identifier.toLowerCase();
  } else {
    const student = await db.get('SELECT email FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?', identifier.toLowerCase(), identifier.toLowerCase());
    if (student && student.email) {
      emailToSend = student.email.toLowerCase();
    }
  }

  if (emailToSend) {
    try {
      const { sendPasswordResetEmail } = require('./lib/supabase');
      const appBaseUrl = process.env.APP_URL || process.env.SITE_URL;
      let origin = req.headers.origin || (appBaseUrl ? appBaseUrl.replace(/\/$/, '') : '');
      if (!origin && req.headers.host) {
        const proto = req.headers['x-forwarded-proto'] || (req.headers.host.includes('localhost') ? 'http' : 'https');
        origin = `${proto}://${req.headers.host}`;
      }
      if (!origin) {
        origin = 'https://semestar-library.vercel.app';
      }
      const redirectTo = `${origin}/reset-password.html`;
      await sendPasswordResetEmail({ email: emailToSend, redirectTo });
    } catch (err) {
      console.warn('[Forgot Password Warning]:', err.message);
    }
  }

  // Always return generic response to prevent account enumeration
  return res.json({
    success: true,
    message: 'If an account exists with that username or email, a password reset link has been sent to the associated email address.'
  });
});

// Resend Email Confirmation Link (Enumeration-Resistant)
app.post('/api/auth/resend-verification', loginRateLimiter, async (req, res) => {
  const identifier = (req.body.identifier || req.body.email || req.body.username || '').trim();

  if (!identifier) {
    return res.status(400).json({ message: 'Please provide your email address or username.' });
  }

  let emailToSend = null;
  if (identifier.includes('@')) {
    emailToSend = identifier.toLowerCase();
  } else {
    const student = await db.get('SELECT email FROM students WHERE LOWER(username) = ? OR LOWER(studentId) = ?', identifier.toLowerCase(), identifier.toLowerCase());
    if (student && student.email) {
      emailToSend = student.email.toLowerCase();
    }
  }

  if (emailToSend) {
    try {
      const { resendVerificationEmail } = require('./lib/supabase');
      await resendVerificationEmail({ email: emailToSend });
    } catch (err) {
      console.warn('[Resend Verification Warning]:', err.message);
    }
  }

  return res.json({
    success: true,
    message: 'If an unverified account exists, a new verification email has been sent.'
  });
});

// Synchronize password reset completion: revokes mobile tokens, updates passwordHash to supabase_auth, sets verified
app.post('/api/auth/sync-password-reset', requireLogin, async (req, res) => {
  const studentId = req.user.studentId;
  const supabaseUid = req.user.supabaseUid;
  if (!studentId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    if (db.isPostgres) {
      await db.run(
        `UPDATE students SET passwordHash = 'supabase_auth', verification_status = 'verified', supabase_uid = COALESCE($1, supabase_uid), updated_at = CURRENT_TIMESTAMP WHERE studentId = $2`,
        supabaseUid || null, studentId
      );
    } else {
      await db.run(
        `UPDATE students SET passwordHash = 'supabase_auth', verification_status = 'verified', supabase_uid = COALESCE(?, supabase_uid), updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
        supabaseUid || null, studentId
      );
    }

    // Revoke all existing mobile tokens for this student so old tokens cannot be used after password reset
    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', studentId);

    return res.json({ success: true, message: 'Password reset synchronized and mobile tokens revoked.' });
  } catch (err) {
    console.error('[Sync Password Reset Error]:', err.message);
    return res.status(500).json({ message: 'Failed to synchronize password reset.' });
  }
});

// Synchronize email confirmation status to database
app.post('/api/auth/sync-verification', requireLogin, async (req, res) => {
  const studentId = req.user.studentId;
  const supabaseUid = req.user.supabaseUid;
  if (!studentId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    if (db.isPostgres) {
      await db.run(
        `UPDATE students SET verification_status = 'verified', supabase_uid = COALESCE($1, supabase_uid), updated_at = CURRENT_TIMESTAMP WHERE studentId = $2`,
        supabaseUid || null, studentId
      );
    } else {
      await db.run(
        `UPDATE students SET verification_status = 'verified', supabase_uid = COALESCE(?, supabase_uid), updated_at = CURRENT_TIMESTAMP WHERE studentId = ?`,
        supabaseUid || null, studentId
      );
    }

    return res.json({ success: true, message: 'Verification status synchronized.' });
  } catch (err) {
    console.error('[Sync Verification Error]:', err.message);
    return res.status(500).json({ message: 'Failed to synchronize email verification.' });
  }
});

// Synchronize browser session cookie (__gu_session) for authenticated Supabase web clients
app.post('/api/auth/sync-session', requireLogin, async (req, res) => {
  const student = req.user || req.student;
  if (!student || !student.studentId) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  if (req.session) {
    req.session.studentId = student.studentId;
    req.session.studentName = student.name;
    req.session.role = student.role || 'student';
    await new Promise(resolve => {
      if (typeof req.session.save === 'function') {
        req.session.save(resolve);
      } else {
        resolve();
      }
    });
  }

  return res.json({
    ok: true,
    studentId: student.studentId,
    name: student.name,
    role: student.role || 'student'
  });
});

app.get('/api/me', requireLogin, async (req, res) => {
  const studentId = req.user.studentId;
  const profile = await getStudentProfile(studentId, studentId);
  const role = req.user.role || 'student';
  const isAdmin = role === 'admin';
  const isCR = role === 'cr' || role === 'class_rep';
  res.json({
    studentId: req.user.studentId,
    username: req.user.username || profile?.username || null,
    name: req.user.name,
    role,
    isAdmin,
    isCR,
    department: req.user.department || profile?.department || 'BIT',
    semester: role === 'teacher' ? null : (req.user.semester || profile?.semester || 'Semester 1'),
    cohortId: role === 'teacher' ? null : (req.user.cohortId || profile?.cohortId || null),
    gender: req.user.gender || null,
    email: req.user.email || profile?.email || null,
    avatarUrl: req.user.avatarUrl || profile?.avatarUrl || null,
    bio: profile?.bio || '',
    githubUrl: profile?.githubUrl || '',
    linkedinUrl: profile?.linkedinUrl || '',
    verificationStatus: req.user.verificationStatus || profile?.verificationStatus || 'unverified',
    subjects: profile?.subjects || [],
    stats: profile?.stats || { filesCount: 0, likesReceived: 0, followersCount: 0, followingCount: 0 }
  });
});

app.post('/api/games/ticket', auth.requireLogin, async (req, res) => {
  try {
    const ticket = gamesTicket.createGamesTicket(req.user);
    res.json({
      ticket,
      expiresIn: gamesTicket.TICKET_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[Games Ticket Error]:', err.message);
    res.status(500).json({
      message: 'Failed to issue Games ticket. Please try again later.',
    });
  }
});

app.use('/api/games', require('./routes/games')(db, auth.requireLogin));

app.post('/api/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ message: 'Current password is required.' });
  }

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ message: 'New password is required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
  }

  if (newPassword.length > 100) {
    return res.status(400).json({ message: 'New password cannot exceed 100 characters.' });
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'New passwords do not match.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ message: 'New password must be different from current password.' });
  }

  const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId;
  if (!studentId) {
    return res.status(401).json({ message: 'Authentication required. Please sign in.' });
  }

  const student = await db.get(
    'SELECT studentId, email, passwordHash, supabase_uid FROM students WHERE studentId = ?',
    studentId
  );
  if (!student) {
    return res.status(404).json({ message: 'User not found.' });
  }

  // Transitional Authentication Audit:
  // Account types:
  // 1. Supabase-authenticated (passwordHash === 'supabase_auth' or supabase_uid set)
  // 2. Legacy Semester Library credentials (bcrypt passwordHash)
  // 3. Linked/migrated accounts (both present)
  let passwordMatches = false;
  let supabaseSession = null;
  let supabaseUser = null;

  // Check 1: Verify against local bcrypt passwordHash if valid bcrypt hash
  if (student.passwordHash && student.passwordHash !== 'supabase_auth') {
    try {
      passwordMatches = bcrypt.compareSync(currentPassword, student.passwordHash);
    } catch (_) {}
  }

  // Check 2: Verify against Supabase Auth if user has an email and Supabase credentials exist
  if (student.email) {
    try {
      const { authenticateWithPassword } = require('./lib/supabase');
      const { data, error } = await authenticateWithPassword({
        email: student.email.toLowerCase().trim(),
        password: currentPassword,
      });
      if (!error && data && data.user) {
        passwordMatches = true;
        supabaseUser = data.user;
        supabaseSession = data.session;
      }
    } catch (_) {}
  }

  if (!passwordMatches) {
    return res.status(401).json({ message: 'Incorrect current password.' });
  }

  // Hash and persist new password locally
  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE students SET passwordHash = ? WHERE studentId = ?', newHash, studentId);

  // Synchronize new password to Supabase Auth if applicable
  const targetSupabaseUid = student.supabase_uid || supabaseUser?.id || null;
  let supabaseUpdated = false;

  // Method A: Update via authenticated Supabase user session (doesn't require master service role key)
  if (supabaseSession?.access_token) {
    try {
      const { getSupabaseConfig } = require('./lib/supabase');
      const { url, key } = getSupabaseConfig();
      if (url && key) {
        const { createClient } = require('@supabase/supabase-js');
        const userClient = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${supabaseSession.access_token}` } }
        });
        const { error: userUpdErr } = await userClient.auth.updateUser({ password: newPassword });
        if (!userUpdErr) {
          supabaseUpdated = true;
        }
      }
    } catch (sbUserErr) {
      console.warn('[Supabase User Session Password Update Warning]:', sbUserErr.message);
    }
  }

  // Method B: If not updated via user session and targetSupabaseUid exists, try Supabase Admin API
  if (!supabaseUpdated && targetSupabaseUid) {
    try {
      const { getSupabaseAdminClient } = require('./lib/supabase');
      const admin = getSupabaseAdminClient();
      const adminRes = await admin.auth.admin.updateUserById(targetSupabaseUid, { password: newPassword });
      if (!adminRes.error) {
        supabaseUpdated = true;
      }
    } catch (supErr) {
      // Handled below if required for Supabase-only accounts
    }
  }

  // If student was missing supabase_uid in local DB but has one from Supabase, link it now
  if (!student.supabase_uid && targetSupabaseUid) {
    await db.run('UPDATE students SET supabase_uid = ? WHERE studentId = ?', targetSupabaseUid, studentId).catch(() => {});
  }

  // Revoke other active web sessions for this student upon password change
  const currentSid = req.sessionID;
  try {
    if (db.isPostgres) {
      await db.run(
        `DELETE FROM session WHERE sid != $1 AND (sess->>'studentId' = $2 OR sess::text LIKE '%' || $2 || '%')`,
        currentSid || '', studentId
      );
    } else {
      await db.run(
        `DELETE FROM session WHERE sid != ? AND sess LIKE ?`,
        currentSid || '', `%"studentId":"${studentId}"%`
      );
    }
  } catch (sessErr) {
    console.warn('[Session Revocation Warning]:', sessErr.message);
  }

  // Revoke other mobile bearer tokens for this student (preserve caller's active token so current session continues working)
  const callerMobileToken = req.mobileToken || (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7).trim() : null);
  try {
    if (callerMobileToken) {
      await db.run('DELETE FROM mobile_tokens WHERE studentId = ? AND token != ?', studentId, callerMobileToken);
    } else {
      await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', studentId);
    }
  } catch (tokErr) {
    console.warn('[Mobile Token Revocation Warning]:', tokErr.message);
  }

  res.json({ success: true, message: 'Password successfully updated' });
});

// ============================================================
// ACCOUNT DELETION ENDPOINTS (Google Play Policy Compliance)
// ============================================================

// Authenticated in-app account deletion
app.all(['/api/account/delete', '/api/account'], requireLogin, async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const studentId = req.student?.studentId || req.session?.studentId;
  if (!studentId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ message: 'Current password is required to confirm account deletion.' });
  }

  const student = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  if (!student) {
    return res.status(404).json({ message: 'Account not found.' });
  }

  const match = bcrypt.compareSync(password, student.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Incorrect password. Account deletion aborted.' });
  }

  try {
    // 1. Revoke all mobile bearer tokens
    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', studentId);

    // 2. Remove registered device push tokens and queued notifications
    await db.run('DELETE FROM student_device_tokens WHERE student_id = ?', studentId);
    await db.run('DELETE FROM student_notification_preferences WHERE student_id = ?', studentId);
    await db.run('DELETE FROM push_notification_outbox WHERE recipient_student_id = ?', studentId);
    await db.run('DELETE FROM notification_recipients WHERE user_id = ?', studentId);
    await db.run('DELETE FROM notifications WHERE actor_id = ? OR recipientStudentId = ?', studentId, studentId);

    // 3. Remove personal social interactions & feed posts
    await db.run('DELETE FROM file_likes WHERE studentId = ?', studentId);
    await db.run('DELETE FROM file_comments WHERE studentId = ?', studentId);
    await db.run('DELETE FROM post_likes WHERE user_id = ?', studentId);
    await db.run('DELETE FROM post_comments WHERE user_id = ?', studentId);
    await db.run('DELETE FROM follows WHERE followerId = ? OR followingId = ?', studentId, studentId);

    // Clean up student's personal feed posts and delete attached post image blobs
    try {
      const userPosts = await db.all('SELECT id, attachment_url FROM posts WHERE user_id = ?', studentId);
      for (const p of userPosts) {
        if (p.attachment_url && /^\/uploads\/posts\/[a-f0-9-]+\.[a-z]+$/.test(p.attachment_url)) {
          const filename = path.basename(p.attachment_url);
          await db.deleteFileBlob(filename).catch(() => {});
        }
      }
      await db.run('DELETE FROM posts WHERE user_id = ?', studentId);
    } catch (postErr) {
      console.warn('[Account Deletion Post Cleanup Notice]:', postErr.message);
    }

    // 4. Invalidate all active web sessions for this student
    if (db.isPostgres) {
      await db.run(`DELETE FROM session WHERE sess->>'studentId' = $1 OR sess::text LIKE '%' || $1 || '%'`, studentId);
    } else {
      await db.run(`DELETE FROM session WHERE sess LIKE ?`, `%"studentId":"${studentId}"%`);
    }

    // 5. Delete student record from students table
    await db.run('DELETE FROM students WHERE studentId = ?', studentId);

    // 6. Terminate current session
    if (req.session && typeof req.session.destroy === 'function') {
      req.session.destroy(() => {});
    }
    if (res.clearCookie) {
      res.clearCookie('__gu_session');
    }

    return res.json({
      success: true,
      message: 'Your account and personal data have been permanently deleted.'
    });
  } catch (deleteErr) {
    console.error('[Account Deletion Error]:', deleteErr);
    return res.status(500).json({ message: 'Failed to complete account deletion. Please try again or contact support.' });
  }
});

// Public web deletion request endpoint (for users without the app)
app.post('/api/account/delete-request', async (req, res) => {
  const { studentId, password, confirmPermanent } = req.body || {};

  if (!studentId || !password) {
    return res.status(400).json({ message: 'Student ID and password are required.' });
  }

  if (!confirmPermanent) {
    return res.status(400).json({ message: 'You must confirm that you understand this action is permanent.' });
  }

  const student = await db.get('SELECT * FROM students WHERE studentId = ?', String(studentId).trim());
  if (!student) {
    return res.status(401).json({ message: 'Invalid credentials. Account deletion request rejected.' });
  }

  const match = bcrypt.compareSync(password, student.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid credentials. Account deletion request rejected.' });
  }

  const sid = student.studentId;
  try {
    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', sid);
    await db.run('DELETE FROM student_device_tokens WHERE student_id = ?', sid);
    await db.run('DELETE FROM student_notification_preferences WHERE student_id = ?', sid);
    await db.run('DELETE FROM push_notification_outbox WHERE recipient_student_id = ?', sid);
    await db.run('DELETE FROM notification_recipients WHERE user_id = ?', sid);
    await db.run('DELETE FROM notifications WHERE actor_id = ? OR recipientStudentId = ?', sid, sid);
    await db.run('DELETE FROM file_likes WHERE studentId = ?', sid);
    await db.run('DELETE FROM file_comments WHERE studentId = ?', sid);
    await db.run('DELETE FROM post_likes WHERE user_id = ?', sid);
    await db.run('DELETE FROM post_comments WHERE user_id = ?', sid);
    await db.run('DELETE FROM follows WHERE followerId = ? OR followingId = ?', sid, sid);

    // Clean up student's personal feed posts and delete attached post image blobs
    try {
      const userPosts = await db.all('SELECT id, attachment_url FROM posts WHERE user_id = ?', sid);
      for (const p of userPosts) {
        if (p.attachment_url && /^\/uploads\/posts\/[a-f0-9-]+\.[a-z]+$/.test(p.attachment_url)) {
          const filename = path.basename(p.attachment_url);
          await db.deleteFileBlob(filename).catch(() => {});
        }
      }
      await db.run('DELETE FROM posts WHERE user_id = ?', sid);
    } catch (postErr) {
      console.warn('[Account Deletion Post Cleanup Notice]:', postErr.message);
    }

    if (db.isPostgres) {
      await db.run(`DELETE FROM session WHERE sess->>'studentId' = $1 OR sess::text LIKE '%' || $1 || '%'`, sid);
    } else {
      await db.run(`DELETE FROM session WHERE sess LIKE ?`, `%"studentId":"${sid}"%`);
    }

    await db.run('DELETE FROM students WHERE studentId = ?', sid);

    return res.json({
      success: true,
      message: 'Account successfully and permanently deleted.'
    });
  } catch (err) {
    console.error('[Public Account Deletion Error]:', err);
    return res.status(500).json({ message: 'Failed to delete account. Please contact privacy support.' });
  }
});


app.post('/api/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('__gu_session', { path: '/' });
    return res.json({ message: 'Logged out' });
  }
  req.session.destroy((err) => {
    res.clearCookie('__gu_session', { path: '/' });
    if (err) {
      console.error('[Logout Error]:', err.message);
      return res.status(500).json({ message: 'Logout failed. Please clear your cookies.' });
    }
    res.json({ message: 'Logged out' });
  });
});

app.post('/api/mobile/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  let studentId = req.user?.studentId || req.session?.studentId;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        if (!studentId) {
          const rec = await db.get('SELECT studentId FROM mobile_tokens WHERE token = ?', token);
          if (rec) studentId = rec.studentId || rec.studentid;
        }
        await db.run('DELETE FROM mobile_tokens WHERE token = ?', token);
      } catch (err) {
        console.error('[Mobile Logout Error]:', err.message);
      }
    }
  }

  if (studentId && req.body?.expoPushToken) {
    try {
      await pushNotifications.unregisterDeviceToken(db, {
        studentId,
        expoPushToken: req.body.expoPushToken
      });
    } catch (unregErr) {
      console.error('[Mobile Logout Unregister Token Error]:', unregErr.message);
    }
  }

  return res.json({ message: 'Logged out successfully' });
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
  } catch (e) { }
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
          return res.status(400).json({ message: 'One or more files exceed the 250MB size limit.' });
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
  let semester = (req.body.semester || '').trim() || null;
  let subject = (req.body.subject || '').trim() || null;
  const chapter = (req.body.chapter || '').trim() || null;

  let fileTitlesMap = null;
  if (req.body.fileTitles) {
    try {
      fileTitlesMap = typeof req.body.fileTitles === 'string' ? JSON.parse(req.body.fileTitles) : req.body.fileTitles;
    } catch (_) {}
  }

  const isAdmin = await isStudentAdmin(req.session.studentId);
  const currentStudentId = req.session?.studentId || req.user?.studentId;
  const batchId = (req.body.batchId || req.headers['x-upload-batch-id'] || `batch_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`).trim();

  const academicCtx = await getAcademicContext(db, req);

  if (!isAdmin && academicCtx.role !== 'teacher') {
    for (const f of uploadedFiles) {
      const tempPath = path.join(UPLOAD_DIR, f.filename);
      if (isSafeUploadPath(tempPath) && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
    }
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to upload library notes.' });
  }

  if (academicCtx.role === 'teacher') {
    if (!subject) {
      for (const f of uploadedFiles) {
        const tempPath = path.join(UPLOAD_DIR, f.filename);
        if (isSafeUploadPath(tempPath) && fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      }
      return res.status(400).json({ message: 'Subject is required for teacher uploads.' });
    }
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      const authSub = await validateTeacherSubjectAuthorization(
        db,
        academicCtx.studentId,
        subject,
        semester || req.body.semester_no
      );
      subject = authSub.name;
      semester = `Semester ${authSub.semester}`;
      req.body.semester = semester;
      req.body.semester_no = authSub.semester;
      req.body.subject = subject;
    } catch (authErr) {
      for (const f of uploadedFiles) {
        const tempPath = path.join(UPLOAD_DIR, f.filename);
        if (isSafeUploadPath(tempPath) && fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      }
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  const publishScope = await resolvePublishScope(db, academicCtx, req.body);

  const successfulFiles = [];
  const failedFiles = [];

  for (let i = 0; i < uploadedFiles.length; i++) {
    const f = uploadedFiles[i];
    let fileTitle = null;
    if (Array.isArray(fileTitlesMap) && fileTitlesMap[i] && String(fileTitlesMap[i]).trim()) {
      fileTitle = String(fileTitlesMap[i]).trim();
    } else if (uploadedFiles.length > 1 && title) {
      fileTitle = `${title} (${f.originalname.replace(/\.[^/.]+$/, '')})`;
    } else if (title) {
      fileTitle = title;
    } else {
      fileTitle = f.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    }

    const ext = path.extname(f.originalname).toLowerCase();
    const filePath = path.join(UPLOAD_DIR, f.filename);

    // Intentional failure trigger for testing failure semantics (Option B verification)
    if (f.originalname.includes('__FAIL__') || (req.body.simulatedFailFile === f.originalname)) {
      if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
      failedFiles.push({
        name: f.originalname,
        originalName: f.originalname,
        error: 'Simulated persistence failure for testing'
      });
      continue;
    }

    let previewFilename = null;

    try {
      // 1. Save main file to persistent blob storage
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        await db.saveFileBlob(f.filename, fileBuffer, f.mimetype || 'application/octet-stream');
      }

      // 2. Generate previews asynchronously if applicable
      if (ext === '.pptx') {
        if (isLibreOfficeAvailable()) {
          try {
            const pdfBuf = await convertPptxToPdf(filePath);
            previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.pdf';
            const previewPath = path.join(UPLOAD_DIR, previewFilename);
            fs.writeFileSync(previewPath, pdfBuf);
            await db.saveFileBlob(previewFilename, pdfBuf, 'application/pdf');
          } catch (err) {
            previewFilename = null;
          }
        }
        if (!previewFilename) {
          try {
            const previewHtml = await generatePptxPreview(filePath, fileTitle, f.originalname, null);
            previewFilename = 'preview_' + crypto.randomBytes(16).toString('hex') + '.html';
            const previewPath = path.join(UPLOAD_DIR, previewFilename);
            fs.writeFileSync(previewPath, previewHtml, 'utf8');
            await db.saveFileBlob(previewFilename, Buffer.from(previewHtml, 'utf8'), 'text/html');
          } catch (err) {
            previewFilename = null;
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
          previewFilename = null;
        }
      }

      // 3. Insert file record into database
      const result = await db.run(`
        INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, previewName, cohort_id, semester_no, audience_scope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, f.filename, f.originalname, fileTitle, semester || (publishScope.semesterNo ? String(publishScope.semesterNo) : null), subject, chapter, currentStudentId, f.size, new Date().toISOString(), previewFilename, publishScope.cohortId, publishScope.semesterNo, publishScope.audienceScope);

      const insertedId = result.lastInsertRowid;
      const indexing = await indexUploadedNote({
        id: insertedId,
        storedName: f.filename,
        originalName: f.originalname,
        title: fileTitle,
        semester,
        subject,
        chapter,
        sizeBytes: f.size
      }).catch(() => null);

      successfulFiles.push({
        id: insertedId,
        indexing,
        storedName: f.filename,
        originalName: f.originalname,
        title: fileTitle,
        sizeBytes: f.size,
        previewName: previewFilename,
        cohortId: publishScope.cohortId,
        semesterNo: publishScope.semesterNo,
        audienceScope: publishScope.audienceScope
      });
      // In-app & push notifications are dispatched after file persistence via enqueueMaterialPush
    } catch (fileErr) {
      console.error(`[File persistence failed for ${f.originalname}]:`, fileErr.message);
      if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
      await db.deleteFileBlob(f.filename).catch(() => {});
      failedFiles.push({
        name: f.originalname,
        originalName: f.originalname,
        error: fileErr.message || 'Failed to save file'
      });
    }
  }

  // Material push notification enqueue strictly for successfully persisted files
  if (successfulFiles.length > 0) {
    try {
      const { enqueueMaterialPush, enqueueMaterialBatchPush, dispatchImmediateOutbox } = require('./lib/push-notifications');
      const uploaderStudentId = currentStudentId;
      const uploaderName = req.user?.name || req.session?.studentName || null;
      const uploaderDepartment = req.body?.department || req.user?.department || req.session?.department || null;

      if (successfulFiles.length === 1) {
        // Exactly one file persisted -> single material notification
        const single = successfulFiles[0];
        const enqueueResult = await enqueueMaterialPush(db, {
          fileId: single.id,
          originalName: single.originalName,
          title: single.title,
          semester,
          department: uploaderDepartment,
          subject,
          uploaderStudentId,
          uploaderName,
          cohortId: publishScope.cohortId,
          semesterNo: publishScope.semesterNo,
          audienceScope: publishScope.audienceScope
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          await dispatchImmediateOutbox(db, {
            eventType: 'material',
            eventId: single.id,
            timeoutMs: 3500
          });
        }
      } else {
        // Multi-file batch -> ONE combined batch notification referencing ONLY successfully persisted files
        const enqueueResult = await enqueueMaterialBatchPush(db, {
          batchId,
          files: successfulFiles.map(r => ({ id: r.id, originalName: r.originalName, title: r.title })),
          semester,
          department: uploaderDepartment,
          subject,
          chapter,
          uploaderStudentId,
          uploaderName,
          cohortId: publishScope.cohortId,
          semesterNo: publishScope.semesterNo,
          audienceScope: publishScope.audienceScope
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          await dispatchImmediateOutbox(db, {
            eventType: 'material',
            eventId: batchId,
            timeoutMs: 3500
          });
        }
      }
    } catch (pushErr) {
      console.error('[Material Push Enqueue/Dispatch Error]:', pushErr.message);
    }
  }

  const totalCount = uploadedFiles.length;
  const successCount = successfulFiles.length;
  const failureCount = failedFiles.length;

  if (successCount === 0) {
    return res.status(500).json({
      message: 'All uploaded files failed to persist.',
      batchId,
      successfulFiles: [],
      failedFiles,
      count: 0,
      total: totalCount
    });
  }

  const message = failureCount > 0
    ? `${successCount} of ${totalCount} files uploaded successfully`
    : `${successCount} file${successCount > 1 ? 's' : ''} uploaded successfully`;

  const statusCode = failureCount > 0 ? 207 : 200;

  return res.status(statusCode).json({
    message,
    batchId,
    fileId: successfulFiles[0]?.id,
    files: successfulFiles,
    successfulFiles,
    failedFiles,
    count: successCount,
    total: totalCount,
    isPartial: failureCount > 0,
    isOfficial: isAdmin
  });
});

const ALLOWED_UPLOAD_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.zip', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.webp', '.mp4',
  '.c', '.cpp', '.py', '.java'
]);

const DANGEROUS_UPLOAD_EXTS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.cjs',
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.php', '.cgi',
  '.pl', '.pyc', '.class', '.jar', '.vbs', '.ps1', '.dll', '.so'
]);

function isAllowedUploadFile(filename, mimeType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!ext || DANGEROUS_UPLOAD_EXTS.has(ext) || !ALLOWED_UPLOAD_EXTS.has(ext)) {
    return false;
  }
  const m = (mimeType || '').toLowerCase();
  if (m.includes('html') || m.includes('javascript') || m.includes('svg') || m.includes('x-sh') || m.includes('x-msdownload')) {
    return false;
  }
  return true;
}

function createUploadToken({ studentId, storedName, size, ext, expiresAt }) {
  const secret = process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382';
  const payload = `${studentId}:${storedName}:${size}:${ext}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

function verifyUploadToken(token, { studentId, storedName, size, ext }) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiresAtStr, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  const secret = process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382';
  const payload = `${studentId}:${storedName}:${size}:${ext}:${expiresAt}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
    return true;
  }
  // Check without size in payload in case of minor metadata variation
  const fallbackPayload = `${studentId}:${storedName}:${expiresAt}`;
  const fallbackExpected = crypto.createHmac('sha256', secret).update(fallbackPayload).digest('hex');
  return sig.length === fallbackExpected.length && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(fallbackExpected, 'hex'));
}

// Issue server authorization and pre-assigned filename for direct-to-storage uploads
app.post('/api/files/authorize-upload', requireLogin, async (req, res) => {
  const currentStudentId = req.session?.studentId || req.user?.studentId;
  const isAdmin = await isStudentAdmin(currentStudentId);
  const academicCtx = await getAcademicContext(db, req);

  if (!isAdmin && academicCtx.role !== 'teacher') {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to upload library notes.' });
  }

  const { filename, size, mimeType, subject, semester } = req.body || {};

  if (academicCtx.role === 'teacher' && subject) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      await validateTeacherSubjectAuthorization(db, academicCtx.studentId, subject, semester || req.body.semester_no);
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ message: 'Filename is required.' });
  }

  const cleanOriginalName = path.basename(filename).replace(/[^\w\s.-]/g, '_');
  if (!isAllowedUploadFile(cleanOriginalName, mimeType)) {
    return res.status(400).json({ message: 'File type not permitted for library uploads.' });
  }

  const parsedSize = parseInt(size, 10);
  if (isNaN(parsedSize) || parsedSize <= 0 || parsedSize > 250 * 1024 * 1024) {
    return res.status(400).json({ message: 'File size must be between 1 byte and 250MB.' });
  }

  const ext = path.extname(cleanOriginalName).toLowerCase();
  const cleanBase = path.basename(cleanOriginalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32);
  const studentId = req.session.studentId;
  const storedName = `up_${studentId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}_${cleanBase}${ext}`;
  const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes expiration
  const token = createUploadToken({ studentId, storedName, size: parsedSize, ext, expiresAt });

  res.json({
    storedName,
    token,
    expiresAt,
    originalName: cleanOriginalName,
    size: parsedSize
  });
});

// Record direct client-to-Supabase Storage uploads
app.post('/api/files/record-upload', requireLogin, async (req, res) => {
  const currentStudentId = req.session?.studentId || req.user?.studentId;
  const isAdmin = await isStudentAdmin(currentStudentId);
  const academicCtx = await getAcademicContext(db, req);

  if (!isAdmin && academicCtx.role !== 'teacher') {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to manage library notes.' });
  }

  const { files: uploadedFiles, title, semester, subject, chapter } = req.body;
  if (!uploadedFiles || !Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    return res.status(400).json({ message: 'No file information provided.' });
  }

  let cleanSemester = (semester || '').trim() || null;
  let cleanSubject = (subject || '').trim() || null;
  const cleanChapter = (chapter || '').trim() || null;
  const cleanTitle = (title || '').trim() || null;

  if (academicCtx.role === 'teacher') {
    if (!cleanSubject) {
      return res.status(400).json({ message: 'Subject is required for teacher uploads.' });
    }
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      const authSub = await validateTeacherSubjectAuthorization(
        db,
        academicCtx.studentId,
        cleanSubject,
        cleanSemester || req.body.semester_no
      );
      cleanSubject = authSub.name;
      cleanSemester = `Semester ${authSub.semester}`;
      req.body.semester = cleanSemester;
      req.body.semester_no = authSub.semester;
      req.body.subject = cleanSubject;
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  // Reject arbitrary external URLs, verify server-issued upload authorization, ownership, size and type
  for (const f of uploadedFiles) {
    const sName = String(f.storedName || '').trim();
    if (!sName || sName.includes('..') || sName.includes('/') || sName.includes('\\') || /^https?:\/\//i.test(sName)) {
      return res.status(400).json({ message: 'Invalid or external storage path provided.' });
    }
    const origName = String(f.originalName || f.storedName).trim();
    if (!isAllowedUploadFile(origName, f.mimeType)) {
      return res.status(400).json({ message: `File type not permitted for "${origName}".` });
    }
    const sizeBytes = parseInt(f.size, 10);
    if (isNaN(sizeBytes) || sizeBytes <= 0 || sizeBytes > 250 * 1024 * 1024) {
      return res.status(400).json({ message: 'Invalid file size reported.' });
    }

    // Strictly require valid server-issued authorization token bound to authenticated student
    const token = f.token;
    const hasValidToken = token && verifyUploadToken(token, {
      studentId: req.session.studentId,
      storedName: sName,
      size: sizeBytes,
      ext: path.extname(sName).toLowerCase()
    });

    if (!hasValidToken) {
      return res.status(403).json({
        message: `Valid server-issued upload authorization is strictly required for "${sName}".`
      });
    }

    // Verify this storedName has not already been claimed in the library
    const existingClaim = await db.get('SELECT id, uploadedBy FROM files WHERE storedName = ?', sName);
    if (existingClaim) {
      return res.status(409).json({ message: `The file "${sName}" has already been claimed and registered.` });
    }

    // Verify object exists in Supabase storage and verify its actual size and type
    if (supabase) {
      try {
        const { data: fileData, error: sbError } = await supabase.storage.from('library_files').list('', {
          search: sName
        });
        const matched = fileData ? fileData.find(obj => obj.name === sName) : null;
        if (sbError || !matched) {
          return res.status(400).json({ message: `Could not verify stored file "${sName}" in storage.` });
        }
        // Verify size matches within reasonable margin
        if (matched.metadata && matched.metadata.size) {
          if (Math.abs(matched.metadata.size - sizeBytes) > 2048) {
            return res.status(400).json({ message: `File size mismatch for "${sName}".` });
          }
        }
        // Verify storage object mimetype is not dangerous
        if (matched.metadata && matched.metadata.mimetype) {
          if (!isAllowedUploadFile(sName, matched.metadata.mimetype)) {
            return res.status(400).json({ message: `Uploaded storage file "${sName}" has disallowed MIME type: ${matched.metadata.mimetype}` });
          }
        }
        // Verify object was uploaded recently (within 4 hours) to prevent claiming old orphaned objects
        if (matched.created_at) {
          const uploadedAgeMs = Date.now() - new Date(matched.created_at).getTime();
          if (uploadedAgeMs > 4 * 60 * 60 * 1000) {
            return res.status(400).json({ message: `Upload authorization for "${sName}" has expired.` });
          }
        }
      } catch (verifyErr) {
        console.warn('[Supabase Storage Verify Warning]:', verifyErr.message);
      }
    }
  }

  const publishScope = await resolvePublishScope(db, academicCtx, req.body);
  const results = [];

  try {
    for (const f of uploadedFiles) {
      let fileTitle = cleanTitle;
      if (uploadedFiles.length > 1 && cleanTitle) {
        fileTitle = `${cleanTitle} (${(f.originalName || '').replace(/\.[^/.]+$/, '')})`;
      } else if (!fileTitle) {
        fileTitle = (f.originalName || 'file').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      }

      const storedName = path.basename(f.storedName);
      const originalName = String(f.originalName || 'file').slice(0, 255);
      const sizeBytes = parseInt(f.size, 10) || 0;

      const result = await db.run(`
        INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, previewName, cohort_id, semester_no, audience_scope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, storedName, originalName, fileTitle, cleanSemester || (publishScope.semesterNo ? String(publishScope.semesterNo) : null), cleanSubject, cleanChapter, currentStudentId, sizeBytes, new Date().toISOString(), null, publishScope.cohortId, publishScope.semesterNo, publishScope.audienceScope);

      const insertedId = result.lastInsertRowid;
      const indexing = await indexUploadedNote({ id: insertedId, storedName, originalName, title: fileTitle, semester: cleanSemester, subject: cleanSubject, chapter: cleanChapter, sizeBytes });
      results.push({
        id: insertedId,
        indexing,
        storedName,
        originalName,
        title: fileTitle,
        cohortId: publishScope.cohortId,
        semesterNo: publishScope.semesterNo,
        audienceScope: publishScope.audienceScope
      });
    }
  } catch (err) {
    console.error('Record upload DB insert error:', err);
    return res.status(500).json({ message: 'Failed to save file metadata.' });
  }

  const batchId = (req.body?.batchId || '').trim() || crypto.randomUUID();
  const successfulFiles = results.filter(r => r.id);

  // In-app & push notifications are handled below via enqueueMaterialPush / enqueueMaterialBatchPush

  if (successfulFiles.length > 0) {
    try {
      const { enqueueMaterialPush, enqueueMaterialBatchPush, dispatchImmediateOutbox } = require('./lib/push-notifications');
      const uploaderStudentId = currentStudentId;
      const uploaderName = req.user?.name || req.session?.studentName || null;
      const uploaderDepartment = req.body?.department || req.user?.department || req.session?.department || null;

      if (successfulFiles.length === 1) {
        const single = successfulFiles[0];
        const enqueueResult = await enqueueMaterialPush(db, {
          fileId: single.id,
          originalName: single.originalName,
          title: single.title,
          semester: cleanSemester,
          department: uploaderDepartment,
          subject: cleanSubject,
          uploaderStudentId,
          uploaderName,
          cohortId: publishScope.cohortId,
          semesterNo: publishScope.semesterNo,
          audienceScope: publishScope.audienceScope
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          await dispatchImmediateOutbox(db, {
            eventType: 'material',
            eventId: single.id,
            timeoutMs: 3500
          });
        }
      } else {
        // Multi-file batch -> ONE combined batch notification referencing ONLY successfully persisted files
        const enqueueResult = await enqueueMaterialBatchPush(db, {
          batchId,
          files: successfulFiles.map(r => ({ id: r.id, originalName: r.originalName, title: r.title })),
          semester: cleanSemester,
          department: uploaderDepartment,
          subject: cleanSubject,
          chapter: cleanChapter,
          uploaderStudentId,
          uploaderName,
          cohortId: publishScope.cohortId,
          semesterNo: publishScope.semesterNo,
          audienceScope: publishScope.audienceScope
        });
        if (enqueueResult && enqueueResult.enqueuedCount > 0) {
          await dispatchImmediateOutbox(db, {
            eventType: 'material',
            eventId: batchId,
            timeoutMs: 3500
          });
        }
      }
    } catch (pushErr) {
      console.error('[Record Upload Push Enqueue/Dispatch Error]:', pushErr.message);
    }
  }

  res.json({
    message: `${successfulFiles.length} file${successfulFiles.length > 1 ? 's' : ''} saved successfully`,
    batchId,
    fileId: successfulFiles[0]?.id,
    files: successfulFiles,
    count: successfulFiles.length,
    isOfficial: isAdmin
  });
});

// Fetch details of a single file/material by ID
app.get(['/api/files/:id', '/api/library/files/:id'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const currentStudentId = req.student?.studentId || req.session?.studentId;

  if (!fileId || isNaN(parseInt(fileId, 10))) {
    return res.status(400).json({ message: 'Invalid file ID' });
  }

  const query = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      files.cohort_id, files.semester_no, files.audience_scope,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.id = ?
  `;

  const [viewerIsAdmin, file, context] = await Promise.all([
    req.student ? Promise.resolve(req.student.role === 'admin') : isStudentAdmin(currentStudentId),
    db.get(query, currentStudentId, parseInt(fileId, 10)),
    getAcademicContext(db, req)
  ]);

  if (!file || !assertContentAccess(context, file)) {
    return res.status(404).json({ message: 'Material not found' });
  }

  const processed = {
    ...file,
    cohortId: file.cohort_id || file.cohortId || null,
    cohort_id: file.cohort_id || file.cohortId || null,
    semesterNo: file.semester_no !== undefined ? file.semester_no : (file.semesterNo !== undefined ? file.semesterNo : null),
    semester_no: file.semester_no !== undefined ? file.semester_no : (file.semesterNo !== undefined ? file.semesterNo : null),
    audienceScope: file.audience_scope || file.audienceScope || 'cohort',
    audience_scope: file.audience_scope || file.audienceScope || 'cohort',
    uploaderRole: file.uploaderRole || 'student',
    isOfficial: file.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || file.uploadedBy === currentStudentId
  };

  res.json(processed);
});

app.get('/api/files', requireLogin, async (req, res) => {
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200) : 100;
  const offset = req.query.offset ? Math.max(parseInt(req.query.offset, 10) || 0, 0) : 0;

  const context = await getAcademicContext(db, req);
  const filter = buildAcademicContentFilter(context, {
    tableAlias: 'files',
    requestedCohortId: req.query.cohortId || req.query.cohort_id,
    requestedSemester: req.query.semester || req.query.semester_no
  });

  const isFeedRequest = req.query.feed === '1' || req.query.context === 'feed';
  let teacherFeedSql = '';
  const teacherFeedParams = [];
  let teacherSubjects = Array.isArray(context.assignedSubjects) ? context.assignedSubjects : [];

  const isTeacher = context.role === 'teacher' || context.role === 'faculty';
  let whereSql = filter.sql;
  let whereParams = [...filter.params];

  if (isTeacher) {
    const activeTeacherId = req.session?.studentId || context.studentId || req.user?.studentId || req.student?.studentId;
    if (!teacherSubjects || teacherSubjects.length === 0) {
      try {
        const { getTeacherSubjects } = require('./lib/teacher-service');
        teacherSubjects = await getTeacherSubjects(db, activeTeacherId);
      } catch (_) {}
    }

    if ((!teacherSubjects || teacherSubjects.length === 0) && (req.user?.subjects || context.subjects || context.assignedSubjects)) {
      teacherSubjects = req.user?.subjects || context.subjects || context.assignedSubjects || [];
    }

    if (isTeacher && isFeedRequest) {
      whereSql = '1=1';
      whereParams = [];
      teacherFeedSql = ' AND files.uploadedBy = ?';
      teacherFeedParams.push(activeTeacherId);
    } else {
      const subTerms = [];
      for (const s of (teacherSubjects || [])) {
        if (s.name) subTerms.push(s.name.trim().toLowerCase());
        if (s.code) subTerms.push(s.code.trim().toLowerCase());
        if (s.title) subTerms.push(s.title.trim().toLowerCase());
      }
      if (subTerms.length > 0) {
        const orParts = ['files.uploadedBy = ?'];
        teacherFeedParams.push(activeTeacherId);
        for (const term of subTerms) {
          orParts.push('LOWER(TRIM(files.subject)) = ?');
          teacherFeedParams.push(term);
        }
        teacherFeedSql = ` AND (${orParts.join(' OR ')})`;
      } else {
        teacherFeedSql = ' AND files.uploadedBy = ?';
        teacherFeedParams.push(activeTeacherId);
      }
    }
  }

  let query = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      files.cohort_id, files.semester_no, files.audience_scope, COALESCE(files.sort_order, 0) AS sort_order,
      students.name AS uploaderName,
      CASE WHEN students.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || students.studentId || '?v=' || LENGTH(students.avatarUrl) || '-' || SUBSTR(students.avatarUrl, -12) ELSE students.avatarUrl END AS uploaderAvatar,
      students.role AS uploaderRole,
      COALESCE(fl.likeCount, 0) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      COALESCE(fc.commentCount, 0) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    LEFT JOIN (SELECT fileId, COUNT(*) AS likeCount FROM file_likes GROUP BY fileId) fl ON fl.fileId = files.id
    LEFT JOIN (SELECT fileId, COUNT(*) AS commentCount FROM file_comments GROUP BY fileId) fc ON fc.fileId = files.id
    WHERE ${whereSql}${teacherFeedSql}
    ORDER BY CASE WHEN COALESCE(files.sort_order, 0) > 0 THEN 0 ELSE 1 END ASC, COALESCE(files.sort_order, 0) ASC, files.uploadedAt DESC
  `;

  if (limit !== null) {
    query += ` LIMIT ${limit} OFFSET ${offset}`;
  }

  const currentViewerId = req.session?.studentId || context.studentId || req.user?.studentId || req.student?.studentId || null;
  const queryParams = [currentViewerId, ...whereParams, ...teacherFeedParams];

  const viewerIsAdmin = context.role === 'admin' || Boolean(req.student && req.student.role === 'admin') || Boolean(req.user && req.user.role === 'admin');
  const files = await db.all(query, ...queryParams);

  const teacherSubjectSet = new Set(
    (teacherSubjects || []).flatMap(s => [
      (s.name || '').trim().toLowerCase(),
      (s.code || '').trim().toLowerCase(),
      (s.id || '').trim().toLowerCase()
    ]).filter(Boolean)
  );

  const processed = files.map(f => ({
    ...f,
    cohortId: f.cohort_id || f.cohortId || null,
    cohort_id: f.cohort_id || f.cohortId || null,
    semesterNo: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    semester_no: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    audienceScope: f.audience_scope || f.audienceScope || 'cohort',
    audience_scope: f.audience_scope || f.audienceScope || 'cohort',
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === currentViewerId || (context.role === 'teacher' && teacherSubjectSet.has(String(f.subject || '').trim().toLowerCase()))
  }));

  res.json(processed);
});

// Delete a post/file (Admins can delete any post; teachers can only delete notes for authorized subjects)
app.delete('/api/files/:id', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  // Verify role directly from database
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const isAdmin = viewer.role === 'admin';
  const isTeacher = viewer.role === 'teacher';

  if (!isAdmin && !isTeacher) {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to delete library notes.' });
  }

  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);

  if (!file) {
    return res.status(404).json({ message: 'File/post not found' });
  }

  if (isTeacher) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      await validateTeacherSubjectAuthorization(db, studentId, file.subject);
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  // Remove physical file and preview from uploads/ and persistent blob store
  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) { }
  }
  await db.deleteFileBlob(file.storedName);

  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) { }
    }
    await db.deleteFileBlob(file.previewName);
  }

  if (supabase && file.storedName) {
    try {
      await supabase.storage.from('library_files').remove([file.storedName]);
    } catch (e) { }
  }

  // Remove related likes, comments, and database row
  await db.run('DELETE FROM file_likes WHERE fileId = ?', fileId);
  await db.run('DELETE FROM file_comments WHERE fileId = ?', fileId);
  await db.run('DELETE FROM files WHERE id = ?', fileId);
  await noteSearch.removeNoteIndex(db, fileId);
  await require('./lib/knowledge-sync').onNoteDeleted(db, fileId).catch(() => {});
  require('./ai-assistant').invalidateCache(db);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Support POST /api/files/:id/delete alias
app.post('/api/files/:id/delete', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;

  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });

  const isAdmin = viewer.role === 'admin';
  const isTeacher = viewer.role === 'teacher';

  if (!isAdmin && !isTeacher) {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to delete library notes.' });
  }

  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (isTeacher) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      await validateTeacherSubjectAuthorization(db, studentId, file.subject);
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (err) { }
  }
  await db.deleteFileBlob(file.storedName);

  if (file.previewName) {
    const previewPath = path.join(UPLOAD_DIR, path.basename(file.previewName));
    if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
      try { fs.unlinkSync(previewPath); } catch (err) { }
    }
    await db.deleteFileBlob(file.previewName);
  }

  if (supabase && file.storedName) {
    try {
      await supabase.storage.from('library_files').remove([file.storedName]);
    } catch (e) { }
  }

  await db.run('DELETE FROM file_likes WHERE fileId = ?', fileId);
  await db.run('DELETE FROM file_comments WHERE fileId = ?', fileId);
  await db.run('DELETE FROM files WHERE id = ?', fileId);
  await noteSearch.removeNoteIndex(db, fileId);
  await require('./lib/knowledge-sync').onNoteDeleted(db, fileId).catch(() => {});
  require('./ai-assistant').invalidateCache(db);

  res.json({ success: true, message: 'Post deleted successfully', fileId: parseInt(fileId) });
});

// Batch delete all files in a specific chapter/unit
app.post(['/api/library/chapters/delete-files', '/api/library/chapters/files/delete'], requireLogin, async (req, res) => {
  const studentId = req.session.studentId;
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });
  const isAdmin = viewer.role === 'admin';
  const isTeacher = viewer.role === 'teacher';

  if (!isAdmin && !isTeacher) {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to delete library notes.' });
  }

  let { subject, chapter, fileIds } = req.body || {};
  let targetFiles = [];

  if (Array.isArray(fileIds) && fileIds.length > 0) {
    const placeholders = fileIds.map(() => '?').join(',');
    targetFiles = await db.all(`SELECT * FROM files WHERE id IN (${placeholders})`, ...fileIds);
  } else if (subject && chapter) {
    targetFiles = await db.all('SELECT * FROM files WHERE subject = ? AND chapter = ?', subject, chapter);
  } else {
    return res.status(400).json({ message: 'Missing subject/chapter or fileIds parameter' });
  }

  if (!targetFiles || targetFiles.length === 0) {
    return res.status(404).json({ message: 'No deletable files found for this chapter.' });
  }

  if (isTeacher) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    for (const f of targetFiles) {
      try {
        await validateTeacherSubjectAuthorization(db, studentId, f.subject);
      } catch (authErr) {
        return res.status(authErr.status || 403).json({ message: `Teacher is not authorized to delete notes for subject "${f.subject}".` });
      }
    }
  }

  if (targetFiles.length === 0) {
    return res.status(403).json({ message: 'Forbidden: You do not have permission to delete these files.' });
  }

  let deletedCount = 0;
  try {
    for (const f of targetFiles) {
      const filePath = path.join(UPLOAD_DIR, path.basename(f.storedName));
      if (isSafeUploadPath(filePath) && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (err) { }
      }
      await db.deleteFileBlob(f.storedName);

      if (f.previewName) {
        const previewPath = path.join(UPLOAD_DIR, path.basename(f.previewName));
        if (isSafeUploadPath(previewPath) && fs.existsSync(previewPath)) {
          try { fs.unlinkSync(previewPath); } catch (err) { }
        }
        await db.deleteFileBlob(f.previewName);
      }

      await db.run('DELETE FROM file_likes WHERE fileId = ?', f.id);
      await db.run('DELETE FROM file_comments WHERE fileId = ?', f.id);
      await db.run('DELETE FROM files WHERE id = ?', f.id);
      await noteSearch.removeNoteIndex(db, f.id);
      await require('./lib/knowledge-sync').onNoteDeleted(db, f.id).catch(() => {});
      require('./ai-assistant').invalidateCache(db);
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

// Edit note details (Title, Subject, Chapter) — Restricted to Admins and authorized Teachers only
app.patch(['/api/files/:id', '/api/files/:id/edit'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });
  const isAdmin = viewer.role === 'admin';
  const isTeacher = viewer.role === 'teacher';

  if (!isAdmin && !isTeacher) {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to edit library notes.' });
  }

  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (isTeacher) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      await validateTeacherSubjectAuthorization(db, studentId, file.subject);
      if (req.body.subject && String(req.body.subject).trim() !== file.subject) {
        await validateTeacherSubjectAuthorization(db, studentId, String(req.body.subject).trim());
      }
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  const updates = [];
  const params = [];
  if (req.body.title !== undefined) {
    updates.push('title = ?');
    params.push(String(req.body.title).trim());
  }
  if (req.body.subject !== undefined) {
    updates.push('subject = ?');
    params.push(String(req.body.subject).trim());
  }
  if (req.body.chapter !== undefined) {
    updates.push('chapter = ?');
    params.push(String(req.body.chapter).trim());
  }

  if (updates.length > 0) {
    params.push(fileId);
    await db.run(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`, ...params);
  }

  const updatedFile = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  res.json({ success: true, file: updatedFile });
});

app.put(['/api/files/:id', '/api/files/:id/edit'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const viewer = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
  if (!viewer) return res.status(401).json({ message: 'Authentication required' });
  const isAdmin = viewer.role === 'admin';
  const isTeacher = viewer.role === 'teacher';

  if (!isAdmin && !isTeacher) {
    return res.status(403).json({ message: 'Forbidden: Students are not authorized to edit library notes.' });
  }

  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (isTeacher) {
    const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
    try {
      await validateTeacherSubjectAuthorization(db, studentId, file.subject);
      if (req.body.subject && String(req.body.subject).trim() !== file.subject) {
        await validateTeacherSubjectAuthorization(db, studentId, String(req.body.subject).trim());
      }
    } catch (authErr) {
      return res.status(authErr.status || 403).json({ message: authErr.message });
    }
  }

  const updates = [];
  const params = [];
  if (req.body.title !== undefined) {
    updates.push('title = ?');
    params.push(String(req.body.title).trim());
  }
  if (req.body.subject !== undefined) {
    updates.push('subject = ?');
    params.push(String(req.body.subject).trim());
  }
  if (req.body.chapter !== undefined) {
    updates.push('chapter = ?');
    params.push(String(req.body.chapter).trim());
  }

  if (updates.length > 0) {
    params.push(fileId);
    await db.run(`UPDATE files SET ${updates.join(', ')} WHERE id = ?`, ...params);
  }

  const updatedFile = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  res.json({ success: true, file: updatedFile });
});

app.get(['/api/files/:id/download', '/api/files/download/:id'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const [file, context] = await Promise.all([
    db.get('SELECT * FROM files WHERE id = ?', fileId),
    getAcademicContext(db, req)
  ]);

  if (!file || !assertContentAccess(context, file)) {
    return res.status(404).json({ message: 'File not found' });
  }

  if (file.storedName && (file.storedName.startsWith('http://') || file.storedName.startsWith('https://'))) {
    return res.redirect(file.storedName);
  }

  const filePath = await ensureLocalFile(file.storedName);

  if (!filePath || !fs.existsSync(filePath)) {
    if (supabaseUrl && file.storedName) {
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/library_files/${encodeURIComponent(file.storedName)}?download=${encodeURIComponent(file.originalName)}`;
      return res.redirect(publicUrl);
    }
    return res.status(404).json({ message: 'File missing from server' });
  }

  res.download(filePath, file.originalName, (err) => {
    if (err && !res.headersSent) {
      console.error('Download error:', err);
      res.status(500).json({ message: 'Error downloading file' });
    }
  });
});

// Generate a short-lived signed URL for Office file preview (requires student authentication)
app.get(['/api/files/:id/office-preview-url', '/api/files/:id/office-preview'], requireLogin, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId || isNaN(fileId)) {
    return res.status(400).json({ message: 'Invalid file ID' });
  }

  const [file, context] = await Promise.all([
    db.get('SELECT id, originalName, storedName, cohort_id, semester_no, semester, audience_scope FROM files WHERE id = ?', fileId),
    getAcademicContext(db, req)
  ]);
  if (!file || !assertContentAccess(context, file)) {
    return res.status(404).json({ message: 'File not found' });
  }

  if (!officePreview.isOfficePreviewSupported(file.originalName)) {
    return res.status(400).json({ message: 'File format not supported for Office preview.' });
  }

  const previewData = officePreview.createOfficePreviewUrl(file.id, req);
  res.json(previewData);
});

app.post('/api/files/:id/office-preview', requireLogin, async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId || isNaN(fileId)) {
    return res.status(400).json({ message: 'Invalid file ID' });
  }

  const [file, context] = await Promise.all([
    db.get('SELECT id, originalName, storedName, cohort_id, semester_no, semester, audience_scope FROM files WHERE id = ?', fileId),
    getAcademicContext(db, req)
  ]);
  if (!file || !assertContentAccess(context, file)) {
    return res.status(404).json({ message: 'File not found' });
  }

  if (!officePreview.isOfficePreviewSupported(file.originalName)) {
    return res.status(400).json({ message: 'File format not supported for Office preview.' });
  }

  const previewData = officePreview.createOfficePreviewUrl(file.id, req);
  res.json(previewData);
});

// Serve the actual binary file for Office Online preview via token validation (NO session cookie required)
app.get('/api/files/:id/office-public', async (req, res) => {
  const fileId = parseInt(req.params.id, 10);
  if (!fileId || isNaN(fileId)) {
    return res.status(400).json({ message: 'Invalid file ID' });
  }

  const { expires, signature } = req.query;
  if (!expires || !signature) {
    return res.status(403).json({ message: 'Missing expiry or signature parameters.' });
  }

  const expiresNum = parseInt(expires, 10);
  if (isNaN(expiresNum)) {
    return res.status(403).json({ message: 'Invalid expiry parameter.' });
  }

  const expiresMs = expiresNum < 1e11 ? expiresNum * 1000 : expiresNum;
  if (Date.now() > expiresMs + officePreview.CLOCK_TOLERANCE_MS) {
    return res.status(403).json({ message: 'Office preview link has expired.' });
  }

  if (!officePreview.verifyOfficePreviewSignature(fileId, expires, signature)) {
    return res.status(403).json({ message: 'Invalid signature.' });
  }

  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  if (!officePreview.isOfficePreviewSupported(file.originalName)) {
    return res.status(400).json({ message: 'Unsupported file format for Office preview.' });
  }

  if (file.storedName && (file.storedName.startsWith('http://') || file.storedName.startsWith('https://'))) {
    return res.redirect(file.storedName);
  }

  const filePath = await ensureLocalFile(file.storedName);

  if (!filePath || !fs.existsSync(filePath)) {
    if (supabaseUrl && file.storedName) {
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/library_files/${encodeURIComponent(file.storedName)}?download=${encodeURIComponent(file.originalName)}`;
      return res.redirect(publicUrl);
    }
    return res.status(404).json({ message: 'File missing from server' });
  }

  const mimeType = officePreview.getOfficeMimeType(file.originalName);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(path.resolve(filePath));
});

// View a file in-browser (requires login) — displays preview/inline instead of downloading
app.get('/api/files/:id/view', requireLogin, async (req, res) => {
  const [file, context] = await Promise.all([
    db.get('SELECT * FROM files WHERE id = ?', req.params.id),
    getAcademicContext(db, req)
  ]);

  if (!file || !assertContentAccess(context, file)) {
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
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      return res.sendFile(previewPath);
    }
  }

  if (file.storedName && (file.storedName.startsWith('http://') || file.storedName.startsWith('https://'))) {
    return res.redirect(file.storedName);
  }

  const filePath = await ensureLocalFile(file.storedName);

  if (!filePath || !fs.existsSync(filePath)) {
    if (supabaseUrl && file.storedName) {
      const ext = path.extname(file.originalName).toLowerCase();
      if (['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.txt'].includes(ext)) {
        const publicUrl = `${supabaseUrl}/storage/v1/object/public/library_files/${encodeURIComponent(file.storedName)}`;
        return res.redirect(publicUrl);
      }
    }
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
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
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
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      return res.sendFile(previewPath);
    } catch (err) {
      console.error(`[On-Demand DOCX Preview Error for ID ${file.id}]:`, err.message);
    }
  }

  // 3. For native browser viewable files (PDF, images, text, html)
  const inlineExts = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.txt', '.html'];
  if (inlineExts.includes(ext)) {
    if (ext === '.html' || ext === '.svg') {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    return res.sendFile(filePath);
  }

  // 4. Fallback: download the file
  res.download(filePath, file.originalName);
});

// Toggle/set like on a file (retry-safe)
app.post('/api/files/:id/like', requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const studentId = req.session.studentId;
  const explicitAction = req.body && (req.body.action || (typeof req.body.liked === 'boolean' ? (req.body.liked ? 'like' : 'unlike') : null));

  const existing = await db.get('SELECT 1 FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
  let shouldLike;

  if (explicitAction === 'like') {
    shouldLike = true;
  } else if (explicitAction === 'unlike') {
    shouldLike = false;
  } else {
    shouldLike = !existing;
  }

  if (shouldLike) {
    if (!existing) {
      if (db.isPostgres) {
        await db.run('INSERT INTO file_likes (fileId, studentId) VALUES (?, ?) ON CONFLICT (fileId, studentId) DO NOTHING', fileId, studentId);
      } else {
        await db.run('INSERT OR IGNORE INTO file_likes (fileId, studentId) VALUES (?, ?)', fileId, studentId);
      }
      // Create notification via notification center
      const file = await db.get('SELECT uploadedBy, originalName FROM files WHERE id = ?', fileId);
      if (file && file.uploadedBy !== studentId) {
        try {
          const notifService = require('./lib/notifications-service');
          const likerName = req.session?.studentName || req.user?.name || 'Someone';
          await notifService.createNotification(db, {
            type: 'material_reaction',
            actorId: studentId,
            actorName: likerName,
            title: `${likerName} liked your file`,
            body: `${likerName} liked your file: ${file.originalName || 'Study Material'}`,
            entityType: 'material',
            entityId: String(fileId),
            deepLink: `/material/${fileId}`,
            webPath: `files.html?highlight=${fileId}`,
            groupKey: `material:${fileId}:reactions`,
            recipientUserIds: [file.uploadedBy],
          });
        } catch (notifErr) {
          console.warn('[File like notification error]:', notifErr.message);
        }
      }
    }
  } else {
    if (existing) {
      await db.run('DELETE FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
      try {
        const notifService = require('./lib/notifications-service');
        await notifService.removeReactionFromGroup(db, {
          groupKey: `material:${fileId}:reactions`,
          actorId: studentId,
        });
      } catch (_) {}
    }
  }

  const countRow = await db.get('SELECT COUNT(*) AS c FROM file_likes WHERE fileId = ?', fileId);
  const count = Number(countRow?.c || countRow?.count || 0);
  res.json({ liked: shouldLike, likeCount: count });
});

// List comments on a file
app.get('/api/files/:id/comments', requireLogin, async (req, res) => {
  const currentStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const currentRole = req.session?.role || req.user?.role || req.student?.role || 'student';

  const comments = await db.all(`
    SELECT file_comments.id, file_comments.studentId, file_comments.commentText, file_comments.createdAt,
           students.name AS commenterName, students.avatarUrl, students.role
    FROM file_comments
    JOIN students ON students.studentId = file_comments.studentId
    WHERE fileId = ?
    ORDER BY file_comments.createdAt ASC
  `, req.params.id);

  const formatted = comments.map(c => ({
    id: c.id,
    fileId: Number(req.params.id),
    studentId: c.studentId,
    commentText: c.commentText,
    content: c.commentText,
    createdAt: c.createdAt,
    commenterName: c.commenterName,
    name: c.commenterName,
    avatarUrl: c.avatarUrl,
    role: c.role || 'student',
    canDelete: c.studentId === currentStudentId || currentRole === 'admin'
  }));

  res.json(formatted);
});

// Add a comment to a file
app.post('/api/files/:id/comments', requireLogin, async (req, res) => {
  const text = (req.body.text || req.body.content || '').trim();
  if (!text) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (text.length > 500) return res.status(400).json({ message: 'Comment too long' });

  const currentStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const currentName = req.session?.name || req.user?.name || req.student?.name || 'Someone';

  const result = await db.run(`
    INSERT INTO file_comments (fileId, studentId, commentText, createdAt) VALUES (?, ?, ?, ?)
  `, req.params.id, currentStudentId, text, new Date().toISOString());

  // Create notification via notification center
  const fileId = req.params.id;
  const file = await db.get('SELECT uploadedBy, originalName FROM files WHERE id = ?', fileId);
  if (file && file.uploadedBy !== currentStudentId) {
    try {
      const notifService = require('./lib/notifications-service');
      await notifService.createNotification(db, {
        type: 'material_comment',
        actorId: currentStudentId,
        actorName: currentName,
        title: `${currentName} commented on your file`,
        body: `${currentName} commented on your file: ${file.originalName || 'Study Material'}`,
        entityType: 'material',
        entityId: String(fileId),
        secondaryEntityId: String(result.lastInsertRowid || ''),
        deepLink: `/material/${fileId}`,
        webPath: `files.html?highlight=${fileId}`,
        groupKey: `material:${fileId}:comments`,
        recipientUserIds: [file.uploadedBy],
      });
    } catch (notifErr) {
      console.warn('[File comment notification error]:', notifErr.message);
    }
  }

  const newComment = await db.get(`
    SELECT file_comments.id, file_comments.studentId, file_comments.commentText, file_comments.createdAt,
           students.name AS commenterName, students.avatarUrl, students.role
    FROM file_comments
    JOIN students ON students.studentId = file_comments.studentId
    WHERE file_comments.id = ?
  `, result.lastInsertRowid);

  const count = await db.get('SELECT COUNT(*) AS c FROM file_comments WHERE fileId = ?', req.params.id);

  res.json({
    commentId: result.lastInsertRowid,
    comment: newComment ? {
      id: newComment.id,
      fileId: Number(req.params.id),
      studentId: newComment.studentId,
      commentText: newComment.commentText,
      content: newComment.commentText,
      createdAt: newComment.createdAt,
      commenterName: newComment.commenterName,
      name: newComment.commenterName,
      avatarUrl: newComment.avatarUrl,
      role: newComment.role || 'student',
      canDelete: true
    } : null,
    commentCount: Number(count?.c || 1)
  });
});

// Delete a comment on a file
app.delete('/api/files/:id/comments/:commentId', requireLogin, async (req, res) => {
  const currentStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const currentRole = req.session?.role || req.user?.role || req.student?.role || 'student';

  const comment = await db.get('SELECT studentId FROM file_comments WHERE id = ? AND fileId = ?', req.params.commentId, req.params.id);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  if (comment.studentId !== currentStudentId && currentRole !== 'admin') {
    return res.status(403).json({ message: 'Unauthorized to delete this comment' });
  }

  await db.run('DELETE FROM file_comments WHERE id = ?', req.params.commentId);
  const count = await db.get('SELECT COUNT(*) AS c FROM file_comments WHERE fileId = ?', req.params.id);
  res.json({ message: 'Comment deleted', commentCount: Number(count?.c || 0) });
});

// --- Routine/Exam Endpoints ---
app.use('/api/routine', require('./routes/routine')(db, requireLogin, {
  invalidateCache: () => require('./ai-assistant').invalidateCache(db)
}));

// List all subjects that have at least one file
app.get('/api/library/subjects', async (req, res) => {
  const context = await getAcademicContext(db, req);
  const filter = buildAcademicContentFilter(context, {
    tableAlias: 'files',
    requestedCohortId: req.query.cohortId || req.query.cohort_id,
    requestedSemester: req.query.semester || req.query.semester_no
  });

  const subjects = await db.all(`
    SELECT subject, COUNT(*) AS fileCount, COUNT(DISTINCT chapter) AS chapterCount
    FROM files
    WHERE subject IS NOT NULL AND subject != '' AND ${filter.sql}
    GROUP BY subject
    ORDER BY subject ASC
  `, ...filter.params);

  res.json(subjects);
});

// List chapters within a subject
app.get('/api/library/subjects/:subject/chapters', async (req, res) => {
  const context = await getAcademicContext(db, req);
  const filter = buildAcademicContentFilter(context, {
    tableAlias: 'files',
    requestedCohortId: req.query.cohortId || req.query.cohort_id,
    requestedSemester: req.query.semester || req.query.semester_no
  });

  const chapters = await db.all(`
    SELECT chapter, COUNT(*) AS fileCount
    FROM files
    WHERE subject = ? AND chapter IS NOT NULL AND chapter != '' AND ${filter.sql}
    GROUP BY chapter
    ORDER BY chapter ASC
  `, req.params.subject, ...filter.params);

  const uncategorized = await db.get(`
    SELECT COUNT(*) AS c FROM files WHERE subject = ? AND (chapter IS NULL OR chapter = '') AND ${filter.sql}
  `, req.params.subject, ...filter.params);

  res.json({ chapters, uncategorizedCount: Number(uncategorized?.c || 0) });
});

// Library stats: returns file count grouped by semester, subject, and chapter
app.get('/api/library/stats', async (req, res) => {
  const context = await getAcademicContext(db, req);
  const filter = buildAcademicContentFilter(context, {
    tableAlias: 'files',
    requestedCohortId: req.query.cohortId || req.query.cohort_id,
    requestedSemester: req.query.semester || req.query.semester_no
  });

  const stats = await db.all(`
    SELECT semester, subject, chapter, COUNT(*) AS fileCount
    FROM files
    WHERE ${filter.sql}
    GROUP BY semester, subject, chapter
  `, ...filter.params);
  res.json(stats);
});

// Rename / adjust a subject name (Admin or Teacher assigned to that subject)
app.post('/api/library/subjects/rename', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    const callerId = context?.studentId || req.session?.studentId || req.user?.studentId;
    const isAdminUser = context?.role === 'admin' || (await isStudentAdmin(callerId));
    const isTeacherUser = context?.role === 'teacher';

    if (!isAdminUser && !isTeacherUser) {
      return res.status(403).json({ message: 'Only teachers and admins can adjust subject names.' });
    }

    const oldName = String(req.body?.oldName || req.body?.subject || '').trim();
    const newName = String(req.body?.newName || '').trim().replace(/\s+/g, ' ');
    const code = String(req.body?.code || '').trim();

    if (!oldName || !newName || newName.length < 2 || newName.length > 120) {
      return res.status(400).json({ message: 'Please provide a valid subject name (2–120 characters).' });
    }

    if (isTeacherUser && !isAdminUser) {
      const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
      await validateTeacherSubjectAuthorization(db, callerId, code || oldName);
    }

    if (code) {
      await db.run('UPDATE subjects SET name = ? WHERE UPPER(TRIM(code)) = UPPER(TRIM(?)) OR UPPER(TRIM(id)) = UPPER(TRIM(?))', newName, code, code);
    }
    await db.run('UPDATE subjects SET name = ? WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', newName, oldName);
    await db.run('UPDATE files SET subject = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))', newName, oldName);
    await db.run('UPDATE assignments SET subject = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))', newName, oldName);
    try {
      await db.run('UPDATE library_custom_chapters SET subject = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))', newName, oldName);
    } catch (_) {}
    try {
      await db.run('UPDATE library_chapter_overrides SET subject = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?))', newName, oldName);
    } catch (_) {}

    res.json({ success: true, oldName, newName, code, message: 'Subject name updated' });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || 'Could not rename subject.' });
  }
});

// Create a custom chapter within a subject (Admin or Teacher assigned to that subject)
app.post('/api/library/chapters/create', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    const callerId = context?.studentId || req.session?.studentId || req.user?.studentId;
    const isAdminUser = context?.role === 'admin' || (await isStudentAdmin(callerId));
    const isTeacherUser = context?.role === 'teacher';

    if (!isAdminUser && !isTeacherUser) {
      return res.status(403).json({ message: 'Only teachers and admins can add chapters.' });
    }

    const subject = String(req.body?.subject || '').trim();
    const subjectCode = String(req.body?.subjectCode || req.body?.code || '').trim();
    const semester = String(req.body?.semester || '').trim();
    const chapter = String(req.body?.chapter || '').trim().replace(/\s+/g, ' ');

    if (!subject || !chapter || chapter.length > 120) {
      return res.status(400).json({ message: 'Please provide a valid chapter name (1–120 characters).' });
    }

    if (isTeacherUser && !isAdminUser) {
      const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
      await validateTeacherSubjectAuthorization(db, callerId, subjectCode || subject);
    }

    try {
      const existing = await db.get(
        'SELECT id FROM library_custom_chapters WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND LOWER(TRIM(chapter)) = LOWER(TRIM(?))',
        subject,
        chapter
      );
      if (!existing) {
        await db.run(
          'INSERT INTO library_custom_chapters (subject, semester, chapter, created_by) VALUES (?, ?, ?, ?)',
          subject,
          semester || '',
          chapter,
          callerId || ''
        );
      }
      // If this chapter was previously marked deleted in overrides, un-delete it
      await db.run(
        'DELETE FROM library_chapter_overrides WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND LOWER(TRIM(original_chapter)) = LOWER(TRIM(?)) AND is_deleted = 1',
        subject,
        chapter
      );
    } catch (dbErr) {
      console.warn('Custom chapter insert warning:', dbErr.message);
    }

    res.json({
      success: true,
      subject,
      chapter,
      message: 'Chapter added'
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || 'Could not add chapter.' });
  }
});

// List custom chapters and chapter overrides for a subject
app.get('/api/library/custom-chapters', async (req, res) => {
  try {
    const subject = String(req.query?.subject || '').trim();
    const subjectCode = String(req.query?.code || req.query?.subjectCode || '').trim();
    let rowsPromise;
    let overridesPromise;
    if (subject) {
      rowsPromise = db.all(
        'SELECT id, subject, semester, chapter, created_at FROM library_custom_chapters WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) ORDER BY id ASC',
        subject
      ).catch(() => []);
      if (subjectCode) {
        overridesPromise = db.all(
          'SELECT original_chapter, new_chapter, is_deleted FROM library_chapter_overrides WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) OR (subject_code IS NOT NULL AND subject_code != \'\' AND UPPER(TRIM(subject_code)) = UPPER(TRIM(?))) ORDER BY id ASC',
          subject,
          subjectCode
        ).catch(() => []);
      } else {
        overridesPromise = db.all(
          'SELECT original_chapter, new_chapter, is_deleted FROM library_chapter_overrides WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) ORDER BY id ASC',
          subject
        ).catch(() => []);
      }
    } else {
      rowsPromise = db.all('SELECT id, subject, semester, chapter, created_at FROM library_custom_chapters ORDER BY id ASC').catch(() => []);
      overridesPromise = db.all('SELECT subject, subject_code, original_chapter, new_chapter, is_deleted FROM library_chapter_overrides ORDER BY id ASC').catch(() => []);
    }
    const [rows, overrides] = await Promise.all([rowsPromise, overridesPromise]);
    res.json({ chapters: rows || [], overrides: overrides || [] });
  } catch (_) {
    res.json({ chapters: [], overrides: [] });
  }
});

// Rename / adjust a chapter name within a subject (works for both default syllabus units and custom chapters)
app.post('/api/library/chapters/rename', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    const callerId = context?.studentId || req.session?.studentId || req.user?.studentId;
    const isAdminUser = context?.role === 'admin' || (await isStudentAdmin(callerId));
    const isTeacherUser = context?.role === 'teacher';

    if (!isAdminUser && !isTeacherUser) {
      return res.status(403).json({ message: 'Only teachers and admins can adjust chapter names.' });
    }

    const subject = String(req.body?.subject || '').trim();
    const subjectCode = String(req.body?.subjectCode || req.body?.code || '').trim();
    const oldChapter = String(req.body?.oldChapter || '').trim();
    const originalUnitKey = String(req.body?.originalUnitKey || oldChapter).trim();
    const newChapter = String(req.body?.newChapter || '').trim().replace(/\s+/g, ' ');

    if (!subject || !oldChapter || !newChapter || newChapter.length > 120) {
      return res.status(400).json({ message: 'Please provide valid subject and chapter names.' });
    }

    if (isTeacherUser && !isAdminUser) {
      const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
      await validateTeacherSubjectAuthorization(db, callerId, subjectCode || subject);
    }

    const result = await db.run(
      'UPDATE files SET chapter = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND (LOWER(TRIM(chapter)) = LOWER(TRIM(?)) OR LOWER(TRIM(chapter)) = LOWER(TRIM(?)))',
      newChapter,
      subject,
      oldChapter,
      originalUnitKey
    );
    try {
      await db.run(
        'UPDATE library_custom_chapters SET chapter = ? WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND LOWER(TRIM(chapter)) = LOWER(TRIM(?))',
        newChapter,
        subject,
        oldChapter
      );
    } catch (_) {}

    try {
      const existingOverride = await db.get(
        'SELECT id FROM library_chapter_overrides WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND (LOWER(TRIM(original_chapter)) = LOWER(TRIM(?)) OR LOWER(TRIM(new_chapter)) = LOWER(TRIM(?)))',
        subject,
        originalUnitKey,
        oldChapter
      );
      if (existingOverride) {
        await db.run(
          'UPDATE library_chapter_overrides SET new_chapter = ?, is_deleted = 0, subject_code = COALESCE(NULLIF(?, \'\'), subject_code), updated_by = ? WHERE id = ?',
          newChapter,
          subjectCode,
          callerId || '',
          existingOverride.id
        );
      } else {
        await db.run(
          'INSERT INTO library_chapter_overrides (subject_code, subject, original_chapter, new_chapter, is_deleted, updated_by) VALUES (?, ?, ?, ?, 0, ?)',
          subjectCode || '',
          subject,
          originalUnitKey,
          newChapter,
          callerId || ''
        );
      }
    } catch (ovErr) {
      console.warn('Chapter override save warning:', ovErr.message);
    }

    res.json({
      success: true,
      subject,
      oldChapter,
      originalUnitKey,
      newChapter,
      updatedCount: result?.changes || 0,
      message: 'Chapter renamed'
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || 'Could not rename chapter.' });
  }
});

// Delete an entire chapter (both default syllabus units and custom chapters) and any files within it
app.post('/api/library/chapters/delete', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    const callerId = context?.studentId || req.session?.studentId || req.user?.studentId;
    const isAdminUser = context?.role === 'admin' || (await isStudentAdmin(callerId));
    const isTeacherUser = context?.role === 'teacher';

    if (!isAdminUser && !isTeacherUser) {
      return res.status(403).json({ message: 'Only teachers and admins can delete chapters.' });
    }

    const subject = String(req.body?.subject || '').trim();
    const subjectCode = String(req.body?.subjectCode || req.body?.code || '').trim();
    const chapter = String(req.body?.chapter || '').trim();
    const originalUnitKey = String(req.body?.originalUnitKey || chapter).trim();
    const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : [];

    if (!subject || !chapter) {
      return res.status(400).json({ message: 'Subject and chapter are required.' });
    }

    if (isTeacherUser && !isAdminUser) {
      const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
      await validateTeacherSubjectAuthorization(db, callerId, subjectCode || subject);
    }

    // 1. Delete files belonging to this chapter
    let targetFiles = [];
    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      targetFiles = await db.all(`SELECT * FROM files WHERE id IN (${placeholders})`, ...fileIds);
    } else {
      targetFiles = await db.all(
        'SELECT * FROM files WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND (LOWER(TRIM(chapter)) = LOWER(TRIM(?)) OR LOWER(TRIM(chapter)) = LOWER(TRIM(?)))',
        subject,
        chapter,
        originalUnitKey
      );
    }

    for (const file of (targetFiles || [])) {
      await db.run('DELETE FROM file_likes WHERE fileId = ?', file.id).catch(() => {});
      await db.run('DELETE FROM file_comments WHERE fileId = ?', file.id).catch(() => {});
      await db.run('DELETE FROM files WHERE id = ?', file.id).catch(() => {});
    }

    // 2. Remove from library_custom_chapters if present
    try {
      await db.run(
        'DELETE FROM library_custom_chapters WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND (LOWER(TRIM(chapter)) = LOWER(TRIM(?)) OR LOWER(TRIM(chapter)) = LOWER(TRIM(?)))',
        subject,
        chapter,
        originalUnitKey
      );
    } catch (_) {}

    // 3. Record deletion in library_chapter_overrides so default syllabus chapters stay deleted
    try {
      const existingOverride = await db.get(
        'SELECT id FROM library_chapter_overrides WHERE LOWER(TRIM(subject)) = LOWER(TRIM(?)) AND (LOWER(TRIM(original_chapter)) = LOWER(TRIM(?)) OR LOWER(TRIM(new_chapter)) = LOWER(TRIM(?)))',
        subject,
        originalUnitKey,
        chapter
      );
      if (existingOverride) {
        await db.run(
          'UPDATE library_chapter_overrides SET is_deleted = 1, subject_code = COALESCE(NULLIF(?, \'\'), subject_code), updated_by = ? WHERE id = ?',
          subjectCode,
          callerId || '',
          existingOverride.id
        );
      } else {
        await db.run(
          'INSERT INTO library_chapter_overrides (subject_code, subject, original_chapter, new_chapter, is_deleted, updated_by) VALUES (?, ?, ?, ?, 1, ?)',
          subjectCode || '',
          subject,
          originalUnitKey,
          chapter,
          callerId || ''
        );
      }
    } catch (ovErr) {
      console.warn('Chapter delete override warning:', ovErr.message);
    }

    res.json({
      success: true,
      subject,
      chapter,
      deletedFilesCount: (targetFiles || []).length,
      message: 'Chapter deleted'
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || 'Could not delete chapter.' });
  }
});

// Reorder files within a subject / chapter (Admin or Teacher assigned to that subject)
app.post('/api/library/files/reorder', requireLogin, async (req, res) => {
  try {
    const context = await getAcademicContext(db, req);
    const callerId = context?.studentId || req.session?.studentId || req.user?.studentId;
    const isAdminUser = context?.role === 'admin' || (await isStudentAdmin(callerId));
    const isTeacherUser = context?.role === 'teacher';

    if (!isAdminUser && !isTeacherUser) {
      return res.status(403).json({ message: 'Only teachers and admins can reorder library notes.' });
    }

    const subject = String(req.body?.subject || '').trim();
    const orderedFileIds = Array.isArray(req.body?.orderedFileIds) ? req.body.orderedFileIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) : [];

    if (!orderedFileIds.length) {
      return res.status(400).json({ message: 'No file IDs provided for reordering.' });
    }

    if (isTeacherUser && !isAdminUser && subject) {
      const { validateTeacherSubjectAuthorization } = require('./lib/teacher-service');
      await validateTeacherSubjectAuthorization(db, callerId, subject);
    }

    for (let i = 0; i < orderedFileIds.length; i++) {
      await db.run('UPDATE files SET sort_order = ? WHERE id = ?', i + 1, orderedFileIds[i]);
    }

    res.json({
      success: true,
      message: 'Note order updated.'
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || 'Could not reorder notes.' });
  }
});

// List files with flexible filters (semester, subject, chapter)
app.get('/api/library/files', async (req, res) => {
  const { semester, subject, chapter } = req.query;
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200) : 100;
  const offset = req.query.offset ? Math.max(parseInt(req.query.offset, 10) || 0, 0) : 0;
  const context = await getAcademicContext(db, req);
  const studentId = (req.session && req.session.studentId) || context.studentId || (req.user && req.user.studentId) || null;
  const viewerIsAdmin = context.role === 'admin' || (studentId && !context.authenticated ? await isStudentAdmin(studentId) : false);

  const filter = buildAcademicContentFilter(context, {
    tableAlias: 'files',
    requestedCohortId: req.query.cohortId || req.query.cohort_id,
    requestedSemester: semester
  });

  let teacherSubjects = Array.isArray(context.assignedSubjects) ? context.assignedSubjects : [];
  if (context.role === 'teacher' && studentId && teacherSubjects.length === 0) {
    try {
      const { getTeacherSubjects } = require('./lib/teacher-service');
      teacherSubjects = await getTeacherSubjects(db, studentId);
    } catch (_) {}
  }
  const teacherSubjectSet = new Set(
    (teacherSubjects || []).flatMap(s => [
      (s.name || '').trim().toLowerCase(),
      (s.code || '').trim().toLowerCase(),
      (s.id || '').trim().toLowerCase()
    ]).filter(Boolean)
  );

  let query = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      files.cohort_id, files.semester_no, files.audience_scope, COALESCE(files.sort_order, 0) AS sort_order,
      students.name AS uploaderName,
      CASE WHEN students.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || students.studentId || '?v=' || LENGTH(students.avatarUrl) || '-' || SUBSTR(students.avatarUrl, -12) ELSE students.avatarUrl END AS uploaderAvatar,
      students.role AS uploaderRole,
      COALESCE(fl.likeCount, 0) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      COALESCE(fc.commentCount, 0) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    LEFT JOIN (SELECT fileId, COUNT(*) AS likeCount FROM file_likes GROUP BY fileId) fl ON fl.fileId = files.id
    LEFT JOIN (SELECT fileId, COUNT(*) AS commentCount FROM file_comments GROUP BY fileId) fc ON fc.fileId = files.id
    WHERE ${filter.sql}
  `;
  const params = [studentId || '', ...filter.params];

  if (subject) {
    query += ' AND files.subject = ?';
    params.push(subject);
  }
  if (chapter) {
    query += ' AND files.chapter = ?';
    params.push(chapter);
  }

  query += ` ORDER BY CASE WHEN COALESCE(files.sort_order, 0) > 0 THEN 0 ELSE 1 END ASC, COALESCE(files.sort_order, 0) ASC, files.uploadedAt DESC LIMIT ${limit} OFFSET ${offset}`;

  const files = await db.all(query, ...params);
  const processed = files.map(f => ({
    ...f,
    cohortId: f.cohort_id || f.cohortId || null,
    cohort_id: f.cohort_id || f.cohortId || null,
    semesterNo: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    semester_no: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    audienceScope: f.audience_scope || f.audienceScope || 'cohort',
    audience_scope: f.audience_scope || f.audienceScope || 'cohort',
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === studentId || (context.role === 'teacher' && teacherSubjectSet.has(String(f.subject || '').trim().toLowerCase()))
  }));

  res.json(processed);
});

// Search across files, subjects, and students (public for homepage & library search)
app.get('/api/search', requireLogin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ files: [], subjects: [], students: [] });
  }

  const currentStudentId = req.session ? req.session.studentId : null;
  const cleanQ = q.replace(/^@/, '').trim();
  const likeQuery = `%${q}%`;
  const cleanLikeQuery = `%${cleanQ}%`;
  const viewerIsAdmin = req.user?.role === 'admin' || req.session?.role === 'admin' || (currentStudentId ? await isStudentAdmin(currentStudentId) : false);

  const context = await getAcademicContext(db, req);
  const fileFilter = buildAcademicContentFilter(context, { tableAlias: 'files' });
  const assignmentFilter = buildAcademicContentFilter(context, { tableAlias: 'a' });

  // Search files (title, originalName, subject, chapter, uploadedBy studentId, uploader name)
  const filesQuery = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      files.cohort_id, files.semester_no, files.audience_scope,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE (${fileFilter.sql}) AND (LOWER(files.title) LIKE LOWER(?) OR LOWER(files.originalName) LIKE LOWER(?) OR LOWER(files.subject) LIKE LOWER(?) OR LOWER(files.chapter) LIKE LOWER(?) OR LOWER(files.semester) LIKE LOWER(?) OR LOWER(files.uploadedBy) LIKE LOWER(?) OR LOWER(students.name) LIKE LOWER(?))
    ORDER BY files.uploadedAt DESC
    LIMIT 50
  `;

  // Search subjects
  const subjectsQuery = `
    SELECT subject, COUNT(*) AS fileCount, COUNT(DISTINCT chapter) AS chapterCount
    FROM files
    WHERE subject IS NOT NULL AND subject != '' AND (${fileFilter.sql}) AND LOWER(subject) LIKE LOWER(?)
    GROUP BY subject
    ORDER BY subject ASC
    LIMIT 20
  `;

  // Search students (by studentId, username, name, department, semester)
  const studentsQuery = `
    SELECT studentId, username, name, avatarUrl, role, department, semester, bio,
      (SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount
    FROM students
    WHERE LOWER(studentId) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(username, '')) LIKE LOWER(?) OR LOWER(COALESCE(department, '')) LIKE LOWER(?) OR LOWER(COALESCE(semester, '')) LIKE LOWER(?)
    ORDER BY (role = 'admin') DESC, (role = 'teacher') DESC, (role = 'cr') DESC, name ASC
    LIMIT 15
  `;

  // Search assignments (by title, subject, semester, createdBy, teacher name)
  const assignmentsQuery = `
    SELECT a.*, s.name AS teacherName,
      (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount,
      (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissionCount,
      (SELECT COUNT(DISTINCT COALESCE(sub.questionId, sub.id)) FROM submissions sub WHERE sub.assignmentId = a.id AND sub.studentId = ?) AS mySubmissionCount
    FROM assignments a
    JOIN students s ON s.studentId = a.createdBy
    WHERE (${assignmentFilter.sql}) AND (LOWER(a.title) LIKE LOWER(?) OR LOWER(a.subject) LIKE LOWER(?) OR LOWER(a.semester) LIKE LOWER(?) OR LOWER(a.createdBy) LIKE LOWER(?) OR LOWER(s.name) LIKE LOWER(?))
    ORDER BY a.createdAt DESC
    LIMIT 15
  `;

  // Search feed posts & notices (by title, content, subject, author name/studentId)
  const postFilter = buildAcademicContentFilter(context, { tableAlias: 'p' });
  const postsQuery = `
    SELECT p.id, p.user_id AS studentId, p.title, p.content, p.type, p.category, p.subject, p.semester, p.created_at,
      s.name, s.avatarUrl, s.role,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id = p.id) AS comment_count
    FROM posts p
    JOIN students s ON s.studentId = p.user_id
    WHERE (${postFilter.sql}) AND (LOWER(COALESCE(p.title, '')) LIKE LOWER(?) OR LOWER(COALESCE(p.content, '')) LIKE LOWER(?) OR LOWER(COALESCE(p.subject, '')) LIKE LOWER(?) OR LOWER(p.user_id) LIKE LOWER(?) OR LOWER(s.name) LIKE LOWER(?))
    ORDER BY p.created_at DESC
    LIMIT 15
  `;

  // Execute independent search queries in parallel to minimize WAN latency
  const [files, subjects, students, assignments, posts] = await Promise.all([
    db.all(filesQuery, currentStudentId || '', ...fileFilter.params, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery),
    db.all(subjectsQuery, ...fileFilter.params, likeQuery),
    db.all(studentsQuery, cleanLikeQuery, cleanLikeQuery, cleanLikeQuery, likeQuery, likeQuery).catch(() =>
      db.all(
        `SELECT studentId, name, avatarUrl, role, department, semester, bio,
          (SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount
         FROM students
         WHERE LOWER(studentId) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?)
         ORDER BY (role = 'admin') DESC, (role = 'cr') DESC, name ASC
         LIMIT 10`,
        cleanLikeQuery, cleanLikeQuery
      )
    ),
    db.all(assignmentsQuery, currentStudentId || '', ...assignmentFilter.params, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery).catch(err => {
      console.error('Assignment search error:', err);
      return [];
    }),
    db.all(postsQuery, ...postFilter.params, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery).catch(() => [])
  ]);

  const processedFiles = (files || []).map(f => ({
    ...f,
    cohortId: f.cohort_id || f.cohortId || null,
    cohort_id: f.cohort_id || f.cohortId || null,
    semesterNo: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    semester_no: f.semester_no !== undefined ? f.semester_no : (f.semesterNo !== undefined ? f.semesterNo : null),
    audienceScope: f.audience_scope || f.audienceScope || 'cohort',
    audience_scope: f.audience_scope || f.audienceScope || 'cohort',
    uploaderRole: f.uploaderRole || 'student',
    isOfficial: f.uploaderRole === 'admin',
    canDelete: viewerIsAdmin || f.uploadedBy === (req.session?.studentId || req.user?.studentId)
  }));

  res.json({ files: processedFiles, subjects, students, assignments, posts: posts || [] });
});

// ============================================================
// GROUP CHAT SYSTEM
// ============================================================

const isCohortChatEnabled = (process.env.COHORT_CHAT_PRODUCTION === '1' && (db.isPostgres || process.env.NODE_ENV !== 'test')) || process.env.COHORT_CHAT_LOCAL === '1';

// Safe Cohort Chat Diagnostic Endpoint (No secrets exposed)
app.get('/api/chat/health', async (req, res) => {
  try {
    const { checkCohortProviderConfig } = require('./lib/cohort-chat-providers');
    const providerStatus = checkCohortProviderConfig();

    let databaseReady = false;
    let slotsReady = false;
    let activeRoomCount = 0;
    try {
      if (db.isPostgres) {
        const resTables = await db.all("SELECT table_name FROM information_schema.tables WHERE table_name = 'chat_send_keys'");
        const resCols = await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'chat_group_id'");
        databaseReady = resTables.length > 0 && resCols.length > 0;
      } else {
        const resTables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_send_keys'");
        const resCols = await db.all("PRAGMA table_info(chat_messages)");
        databaseReady = resTables.length > 0 && resCols.some(c => (c.name || '').toLowerCase() === 'chat_group_id');
      }
      const slots = await db.all("SELECT group_code, current_chat_group_id FROM chat_group_slots WHERE current_chat_group_id IS NOT NULL");
      slotsReady = slots.length === 4;
      const countRow = await db.get("SELECT COUNT(*) AS c FROM chat_groups WHERE status = 'active' AND kind = 'cohort'");
      activeRoomCount = Number(countRow?.c || 0);
    } catch (_) {}

    res.json({
      enabled: isCohortChatEnabled,
      databaseReady,
      slotsReady,
      projectionProviderConfigured: providerStatus.configured,
      activeRoomCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

if (isCohortChatEnabled) {
  let cohortService;
  let prepareMiddleware;

  if (process.env.COHORT_CHAT_LOCAL === '1' || (process.env.NODE_ENV === 'test' && process.env.COHORT_CHAT_PRODUCTION !== '1')) {
    const cohortChat = require('./lib/cohort-chat').createCohortChat(db);
    cohortService = cohortChat;
    prepareMiddleware = (req, res, next) => next();
  } else {
    const runtime = require('./lib/cohort-chat-runtime').createProductionCohortRuntime(db);
    cohortService = runtime.service;
    prepareMiddleware = async (req, res, next) => {
      // Lifecycle changes require the separately reviewed academic admin rollout.
      if (req.path.startsWith('/admin/cohorts') || req.path.startsWith('/admin/groups') || req.path.startsWith('/admin/recycle')) {
        return res.status(503).json({ message: 'Cohort administration is temporarily unavailable.' });
      }
      if (req.path.startsWith('/admin/rooms')) return next();
      try {
        const ctx = await runtime.prepare(req.student.studentId, { ...req.query, ...req.body });
        if (req.method === 'GET') runtime.scheduleDrain(ctx.chatGroupId);
        next();
      } catch (error) {
        res.status(error.status || 503).json({ message: error.status === 404 ? 'This conversation is no longer available.' : 'Chat is temporarily unavailable.' });
      }
    };
  }

  // Authoritative cohort router owns ALL /api/chat routes. No fallthrough.
  app.use('/api/chat', requireLogin, prepareMiddleware, require('./routes/cohort-chat')(cohortService));
} else {
  // Legacy global chat endpoints (Fallback ONLY when cohort chat is disabled)

app.get('/api/chat/config', requireLogin, (req, res) => {
  const { url, key } = require('./lib/supabase').getSupabaseConfig();
  res.json({ url, key });
});

app.get('/api/chat/messages', requireLogin, async (req, res) => {
  const since = parseInt(req.query.since || req.query.after) || 0;
  const before = parseInt(req.query.before) || 0;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || (before ? 35 : 200), 200));

  // Parallelize reading messages and read receipts concurrently
  const messagesPromise = (before > 0 || since === 0)
    ? db.all(`
        SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
          students.studentId, students.name, students.avatarUrl,
          COALESCE(NULLIF(reply_msg.text, ''), reply_msg.attachmentOriginalName) AS replyText, reply_student.name AS replySender
        FROM chat_messages
        LEFT JOIN students ON students.studentId = chat_messages.studentId
        LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
        LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
        ${before > 0 ? 'WHERE chat_messages.id < ?' : ''}
        ORDER BY chat_messages.id DESC
        LIMIT ?
      `, ...(before > 0 ? [before, limit] : [limit]))
    : db.all(`
        SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
          students.studentId, students.name, students.avatarUrl,
          COALESCE(NULLIF(reply_msg.text, ''), reply_msg.attachmentOriginalName) AS replyText, reply_student.name AS replySender
        FROM chat_messages
        LEFT JOIN students ON students.studentId = chat_messages.studentId
        LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
        LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
        WHERE chat_messages.id > ?
        ORDER BY chat_messages.id ASC
        LIMIT ?
      `, since, limit);

  const readReceiptsPromise = db.all(`SELECT studentId, lastReadMessageId FROM chat_read_receipts`);

  const [rawMessages, readReceipts] = await Promise.all([messagesPromise, readReceiptsPromise]);
  let messages = rawMessages;
  if (before > 0 || since === 0) {
    messages.reverse(); // restore chronological order
  }

  // Polling must reconcile mutations too: a delta alone never includes a
  // reaction, deleted message or changed attachment on an existing row.
  const recentLimit = Math.max(0, Math.min(parseInt(req.query.recent) || 0, 100));
  const recentMessages = recentLimit ? await db.all(`
    SELECT m.id, m.text, m.attachmentName, m.attachmentOriginalName, m.attachmentMimeType,
      m.replyToId, m.createdAt, s.studentId, s.name, s.avatarUrl,
      COALESCE(NULLIF(reply.text, ''), reply.attachmentOriginalName) AS replyText, author.name AS replySender
    FROM chat_messages m
    LEFT JOIN students s ON s.studentId = m.studentId
    LEFT JOIN chat_messages reply ON reply.id = m.replyToId
    LEFT JOIN students author ON author.studentId = reply.studentId
    ORDER BY m.id DESC LIMIT ?
  `, recentLimit) : [];
  recentMessages.reverse();
  const allMessages = [...messages, ...recentMessages];
  const messageIds = [...new Set(allMessages.map(m => m.id))];
  if (messageIds.length) {
    const placeholders = messageIds.map(() => '?').join(',');
    const [reactions, mentions] = await Promise.all([
      db.all(`SELECT messageId, studentId, emoji FROM chat_reactions WHERE messageId IN (${placeholders})`, ...messageIds),
      db.all(`SELECT cm.message_id, cm.mentioned_student_id, cm.handle, s.username, s.name
        FROM chat_message_mentions cm
        LEFT JOIN students s ON s.studentId = cm.mentioned_student_id
        WHERE cm.message_id IN (${placeholders})`, ...messageIds)
    ]);
    const reactionMap = {};
    reactions.forEach(r => {
      (reactionMap[r.messageId] ||= []).push({ studentId: r.studentId, emoji: r.emoji });
    });
    const mentionMap = {};
    const mentionDetailMap = {};
    mentions.forEach(m => {
      const mid = m.messageId || m.message_id;
      const sid = m.mentionedStudentId || m.mentioned_student_id;
      const h = m.handle || m.username || m.name || sid;
      (mentionMap[mid] ||= []).push(sid);
      (mentionDetailMap[mid] ||= []).push({ studentId: sid, handle: h });
    });
    allMessages.forEach(m => {
      m.reactions = reactionMap[m.id] || [];
      m.mentions = mentionMap[m.id] || [];
      m.mentionsDetail = mentionDetailMap[m.id] || [];
    });
  }
  const typing = await db.all(`SELECT t.studentId, s.name, t.lastTypedAt AS timestamp
    FROM chat_typing t JOIN students s ON s.studentId = t.studentId WHERE t.lastTypedAt > ?`,
    new Date(Date.now() - 3500).toISOString());
  res.setHeader('Cache-Control', 'no-store');
  res.json({ messages, readReceipts, typing, ...(recentLimit ? { recentMessages } : {}) });
});

// Single reusable eligibility predicate for BIT group chat (BIT and B.Sc. CSIT students, excluding non-IT departments like BBA)
const CHAT_ELIGIBILITY_SQL = "(COALESCE(department, 'BIT') IN ('BIT', 'B.Sc. CSIT', 'CSIT') AND (role IS NULL OR role NOT IN ('blocked', 'banned', 'suspended')))";
const CHAT_ELIGIBILITY_S_SQL = "(COALESCE(s.department, 'BIT') IN ('BIT', 'B.Sc. CSIT', 'CSIT') AND (s.role IS NULL OR s.role NOT IN ('blocked', 'banned', 'suspended')))";

app.get('/api/chat/members', requireLogin, async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500) : 200;
    const offset = req.query.offset ? Math.max(parseInt(req.query.offset, 10) || 0, 0) : 0;
    const [members, lastMessages] = await Promise.all([
      db.all(`
        SELECT s.studentId, s.name, s.username,
          CASE WHEN s.avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || s.studentId || '?v=' || LENGTH(s.avatarUrl) || '-' || SUBSTR(s.avatarUrl, -12) ELSE s.avatarUrl END AS avatarUrl,
          s.semester, s.department, s.role,
          r.lastReadMessageId
        FROM students s
        LEFT JOIN chat_read_receipts r ON r.studentId = s.studentId
        WHERE ${CHAT_ELIGIBILITY_S_SQL}
        ORDER BY s.name ASC
        LIMIT ? OFFSET ?
      `, limit, offset),
      db.all(`
        SELECT studentId, MAX(createdAt) AS lastMessageAt
        FROM chat_messages
        GROUP BY studentId
      `)
    ]);

    const lastMsgMap = new Map((lastMessages || []).map(m => [m.studentId, m.lastMessageAt]));
    const combined = (members || []).map(m => ({
      ...m,
      lastMessageAt: lastMsgMap.get(m.studentId) || null
    }));

    res.json({ total: combined.length, members: combined });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// @mention autocomplete: search students by name or username (strictly filtered by chat eligibility)
app.get('/api/chat/mentions/students', requireLogin, async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    const currentStudentId = req.session?.studentId || req.user?.studentId;
    if (!query || query.length < 1) {
      return res.json({ students: [] });
    }

    // Sanitize LIKE pattern (escape % and _ in user input)
    const safeLike = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

    const students = await db.all(`
      SELECT studentId, name, username, avatarUrl
      FROM students
      WHERE studentId != ?
        AND ${CHAT_ELIGIBILITY_SQL}
        AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(username) LIKE ? ESCAPE '\\')
      ORDER BY name ASC
      LIMIT 10
    `, currentStudentId, safeLike, safeLike);

    res.json({ students: students || [] });
  } catch (err) {
    console.error('[Mention Autocomplete Error]:', err.message);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// Pinned Announcement state (persisted in database)
app.get('/api/chat/pinned', requireLogin, async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM chat_pinned WHERE id = 1');
    if (!row) {
      return res.json({ pinned: null });
    }
    const pinned = {
      messageId: row.messageId || row.message_id,
      text: row.text,
      senderName: row.senderName || row.sender_name,
      pinnedBy: row.pinnedBy || row.pinned_by,
      pinnedAt: row.pinnedAt || row.pinned_at
    };
    res.json({ pinned });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pinned message' });
  }
});

app.post('/api/chat/pinned/:id', requireLogin, async (req, res) => {
  try {
    // Only authorized roles (admin, cr) can pin announcements
    const activeStudentId = req.user?.studentId || req.student?.studentId || req.session?.studentId;
    const role = req.user?.role || req.student?.role || req.session?.role || 'student';
    const isAdmin = await isStudentAdmin(activeStudentId);
    if (!isAdmin && role !== 'admin' && role !== 'cr' && role !== 'class_rep') {
      return res.status(403).json({ error: 'Forbidden: Only admins or class representatives can pin messages.' });
    }

    const msgId = parseInt(req.params.id, 10);
    if (!msgId) return res.status(400).json({ error: 'Invalid message ID' });

    const msg = await db.get(`
      SELECT m.id, m.text, m.attachmentName, m.attachmentOriginalName, m.createdAt, s.name AS senderName
      FROM chat_messages m
      LEFT JOIN students s ON s.studentId = m.studentId
      WHERE m.id = ?
    `, msgId);

    if (!msg) return res.status(404).json({ error: 'Message not found' });
    const pinnedMessage = {
      messageId: msg.id,
      text: msg.text || msg.attachmentOriginalName || 'Attachment',
      senderName: msg.senderName || 'Student',
      pinnedBy: req.session.studentName || 'Member',
      pinnedAt: new Date().toISOString()
    };

    if (db.isPostgres) {
      await db.run(`
        INSERT INTO chat_pinned (id, messageId, text, senderName, pinnedBy, pinnedAt)
        VALUES (1, $1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          messageId = EXCLUDED.messageId,
          text = EXCLUDED.text,
          senderName = EXCLUDED.senderName,
          pinnedBy = EXCLUDED.pinnedBy,
          pinnedAt = EXCLUDED.pinnedAt
      `, pinnedMessage.messageId, pinnedMessage.text, pinnedMessage.senderName, pinnedMessage.pinnedBy, pinnedMessage.pinnedAt);
    } else {
      await db.run(`
        INSERT OR REPLACE INTO chat_pinned (id, messageId, text, senderName, pinnedBy, pinnedAt)
        VALUES (1, ?, ?, ?, ?, ?)
      `, pinnedMessage.messageId, pinnedMessage.text, pinnedMessage.senderName, pinnedMessage.pinnedBy, pinnedMessage.pinnedAt);
    }

    await sendBroadcast('pin_message', pinnedMessage);
    res.json({ success: true, pinned: pinnedMessage });
  } catch (err) {
    console.error('[Pin Chat Error]:', err.message);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

app.delete('/api/chat/pinned', requireLogin, async (req, res) => {
  try {
    const activeStudentId = req.user?.studentId || req.student?.studentId || req.session?.studentId;
    const role = req.user?.role || req.student?.role || req.session?.role || 'student';
    const isAdmin = await isStudentAdmin(activeStudentId);
    if (!isAdmin && role !== 'admin' && role !== 'cr' && role !== 'class_rep') {
      return res.status(403).json({ error: 'Forbidden: Only admins or class representatives can unpin messages.' });
    }

    await db.run('DELETE FROM chat_pinned WHERE id = 1');
    await sendBroadcast('pin_message', { unpinned: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

app.post('/api/chat/reactions', requireLogin, async (req, res) => {
  const { messageId, emoji } = req.body;
  const studentId = req.session.studentId;
  if (!Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0 || typeof emoji !== 'string' || !emoji.trim() || emoji.length > 32) return res.status(400).json({ error: 'Invalid reaction' });
  if (!await db.get('SELECT id FROM chat_messages WHERE id = ?', messageId)) return res.status(404).json({ error: 'Message no longer exists' });

  try {
    const existing = await db.get(`SELECT * FROM chat_reactions WHERE messageId = ? AND studentId = ?`, messageId, studentId);
    let action = 'add';
    if (existing) {
      if (existing.emoji === emoji) {
        // Toggle off if same emoji clicked again
        await db.run(`DELETE FROM chat_reactions WHERE messageId = ? AND studentId = ?`, messageId, studentId);
        action = 'remove';
      } else {
        // Update reaction to the new emoji
        await db.run(`UPDATE chat_reactions SET emoji = ? WHERE messageId = ? AND studentId = ?`, emoji, messageId, studentId);
        action = 'update';
      }
    } else {
      await db.run(`INSERT INTO chat_reactions (messageId, studentId, emoji) VALUES (?, ?, ?)`, messageId, studentId, emoji);
      action = 'add';
    }

    await sendBroadcast('reaction_update', { messageId, studentId, emoji, action });

    res.json({ success: true, action });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

app.post('/api/chat/read', requireLogin, async (req, res) => {
  const lastReadMessageId = parseInt(req.body.lastReadMessageId, 10);
  const studentId = req.session.studentId;
  if (!Number.isSafeInteger(lastReadMessageId) || lastReadMessageId <= 0) return res.status(400).json({ error: 'Missing or invalid lastReadMessageId' });

  try {
    const current = await db.get('SELECT lastReadMessageId FROM chat_read_receipts WHERE studentId = ?', studentId);
    const currentRead = current ? Number(current.lastReadMessageId || current.last_read_message_id || 0) : 0;
    // Prevent read receipts from moving backwards
    if (currentRead >= lastReadMessageId) {
      return res.json({ success: true, lastReadMessageId: currentRead });
    }

    if (db.isPostgres) {
      await db.run(`
        INSERT INTO chat_read_receipts (studentId, lastReadMessageId) VALUES ($1, $2)
        ON CONFLICT(studentId) DO UPDATE SET lastReadMessageId = GREATEST(chat_read_receipts.lastReadMessageId, EXCLUDED.lastReadMessageId)
      `, studentId, lastReadMessageId);
    } else {
      await db.run(`
        INSERT INTO chat_read_receipts (studentId, lastReadMessageId) VALUES (?, ?)
        ON CONFLICT(studentId) DO UPDATE SET lastReadMessageId = MAX(chat_read_receipts.lastReadMessageId, excluded.lastReadMessageId)
      `, studentId, lastReadMessageId);
    }

    sendBroadcast('read_receipt', { studentId, lastReadMessageId });

    res.json({ success: true, lastReadMessageId });
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
  chatUpload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'file', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ message: err.message || String(err) });
    }
    if (req.files) {
      req.file = (req.files['attachment'] && req.files['attachment'][0]) ||
                 (req.files['file'] && req.files['file'][0]) ||
                 undefined;
    }
    next();
  });
};

const recentClientMessages = new Map(); // clientId -> { messageId, data, timestamp }

app.post('/api/chat/messages', requireLogin, chatRateLimiter, handleChatUpload, async (req, res) => {
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();
  const file = req.file;
  const replyToId = req.body.replyToId ? parseInt(req.body.replyToId, 10) : null;
  const clientId = (req.body && req.body.clientId ? String(req.body.clientId) : '').trim() || null;

  // Parse mentions: client sends JSON array of studentIds
  let rawMentions = [];
  try {
    const mentionsInput = req.body.mentions || req.body.mentionedStudentIds;
    if (typeof mentionsInput === 'string') {
      rawMentions = JSON.parse(mentionsInput);
    } else if (Array.isArray(mentionsInput)) {
      rawMentions = mentionsInput;
    }
  } catch (_) { rawMentions = []; }

  // Idempotency: if client retries with the same clientId within 60s, return cached response
  if (clientId && recentClientMessages.has(clientId)) {
    const cached = recentClientMessages.get(clientId);
    if (Date.now() - cached.timestamp < 60000) {
      if (file) fs.unlink(file.path, () => {});
      return res.json({ message: 'Sent', messageId: cached.messageId, data: cached.data, clientId });
    }
  }

  if (req.body.replyToId && (!Number.isSafeInteger(replyToId) || replyToId <= 0 || !await db.get('SELECT id FROM chat_messages WHERE id = ?', replyToId))) {
    if (file) fs.unlink(file.path, () => {});
    return res.status(404).json({ message: 'The message you are replying to no longer exists.' });
  }

  if (!text && !file) {
    return res.status(400).json({ message: 'Cannot send an empty message.' });
  }

  if (text.length > 2000) {
    if (file) fs.unlink(file.path, () => { });
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
      {
        const fileBuffer = fs.readFileSync(file.path);
        const saved = await db.saveFileBlob(file.filename, fileBuffer, file.mimetype || 'application/octet-stream');
        if (!saved) throw new Error('Attachment storage unavailable');
      }
    } catch (err) {
      fs.unlink(file.path, () => {});
      console.error('Chat attachment storage failed:', err.message);
      return res.status(503).json({ message: 'Could not save the attachment. Please try again.' });
    }
  }

  try {
    const currentSenderId = req.session?.studentId || req.user?.studentId;
    console.log('[PUSH-DIAG-CHAT] 1. Sender Student ID:', currentSenderId);

    const senderRow = await db.get(
      'SELECT studentId, name, username, department, role FROM students WHERE studentId = ?',
      currentSenderId
    );
    if (!senderRow) {
      if (file) fs.unlink(file.path, () => {});
      return res.status(401).json({ error: 'Unauthorized: Sender does not exist' });
    }
    const isSenderEligible = (
      (senderRow.department === null || senderRow.department === undefined || ['BIT', 'B.SC. CSIT', 'CSIT'].includes(senderRow.department.toUpperCase())) &&
      (!senderRow.role || !['blocked', 'banned', 'suspended'].includes(senderRow.role))
    );
    if (!isSenderEligible) {
      if (file) fs.unlink(file.path, () => {});
      return res.status(403).json({ error: 'Forbidden: Sender is not eligible for this chat' });
    }

    // ── Parse and validate @mentions ──
    let rawMentions = [];
    try {
      const mentionsInput = req.body.mentions || req.body.mentionedStudentIds;
      if (typeof mentionsInput === 'string') {
        rawMentions = JSON.parse(mentionsInput);
      } else if (Array.isArray(mentionsInput)) {
        rawMentions = mentionsInput;
      }
    } catch (_) { rawMentions = []; }

    const extractedIds = (Array.isArray(rawMentions) ? rawMentions : []).map(item => {
      if (item && typeof item === 'object' && item.studentId) return String(item.studentId).trim();
      return String(item || '').trim();
    }).filter(Boolean);

    // Deduplicate
    const uniqueMentionIds = Array.from(new Set(extractedIds)).slice(0, 50);

    // Sender's own ID is safely ignored for notification purposes without failing
    const recipientCandidateIds = uniqueMentionIds.filter(id => id !== String(currentSenderId));

    let validatedMentions = []; // array of { studentId, handle }
    if (recipientCandidateIds.length > 0) {
      const placeholders = recipientCandidateIds.map(() => '?').join(',');
      const eligibleStudents = await db.all(
        `SELECT studentId, username FROM students WHERE studentId IN (${placeholders}) AND ${CHAT_ELIGIBILITY_SQL}`,
        ...recipientCandidateIds
      );

      const eligibleMap = new Map((eligibleStudents || []).map(s => [s.studentId, s.username]));
      const invalidIds = recipientCandidateIds.filter(id => !eligibleMap.has(id));

      // Strict rejection: if client submits nonexistent or ineligible mention IDs, reject with 400
      if (invalidIds.length > 0) {
        if (file) fs.unlink(file.path, () => {});
        return res.status(400).json({
          error: 'One or more mentioned students are invalid or ineligible for this chat',
          invalidStudentIds: invalidIds
        });
      }

      validatedMentions = recipientCandidateIds.map(id => ({
        studentId: id,
        handle: eligibleMap.get(id) || id
      }));
    }

    // ── Atomically execute message creation, mentions, and outbox enqueue in one transaction ──
    let messageId;
    let enqueueResult;

    await db.withTransaction(async (tx) => {
      // 1. insert chat_messages
      const result = await tx.run(`
        INSERT INTO chat_messages (studentId, text, attachmentName, attachmentOriginalName, attachmentMimeType, replyToId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, currentSenderId, text, attachmentName, attachmentOriginalName, attachmentMimeType, replyToId, new Date().toISOString());

      messageId = result.lastInsertRowid;

      // 2. insert chat_message_mentions
      for (const m of validatedMentions) {
        if (tx.isPostgres) {
          await tx.run(
            `INSERT INTO chat_message_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)
             ON CONFLICT (message_id, mentioned_student_id) DO NOTHING`,
            messageId, m.studentId, m.handle
          );
        } else {
          await tx.run(
            `INSERT OR IGNORE INTO chat_message_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)`,
            messageId, m.studentId, m.handle
          );
        }
      }

      // Injected failure regression test point 1 (before outbox insertion)
      if (process.env.TEST_INJECT_CHAT_FAIL === 'before_outbox') {
        throw new Error('Injected failure: before outbox enqueue');
      }

      // 3. enqueue logical push/outbox records
      const { enqueueChatPushWithThrottle } = require('./lib/push-notifications');
      enqueueResult = await enqueueChatPushWithThrottle(tx, {
        messageId,
        senderStudentId: currentSenderId,
        senderName: senderRow.name || null,
        text: text ? text.trim() : null,
        attachmentMimeType: attachmentMimeType || (file ? file.mimetype : null),
        attachmentOriginalName: attachmentOriginalName || (file ? file.originalname : null),
        mentionedStudentIds: validatedMentions.map(m => m.studentId)
      });

      // Injected failure regression test point 2 (after outbox insertion, before commit)
      if (process.env.TEST_INJECT_CHAT_FAIL === 'after_outbox') {
        throw new Error('Injected failure: after outbox enqueue');
      }
    });

    // ── Transaction committed: fetch message for broadcast and dispatch push ──
    const newMsg = await db.get(`
      SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
        students.studentId, students.name, students.avatarUrl,
        COALESCE(NULLIF(reply_msg.text, ''), reply_msg.attachmentOriginalName) AS replyText, reply_student.name AS replySender
      FROM chat_messages
      LEFT JOIN students ON students.studentId = chat_messages.studentId
      LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
      LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
      WHERE chat_messages.id = ?
    `, messageId);

    // Attach validated mentions to the message object for broadcast
    if (newMsg) {
      newMsg.mentions = validatedMentions.map(m => m.studentId);
      newMsg.mentionsDetail = validatedMentions;
    }

    // Push notification immediate dispatch (bounded synchronous dispatch)
    try {
      if (enqueueResult && enqueueResult.enqueuedCount > 0) {
        const { dispatchImmediateOutbox } = require('./lib/push-notifications');
        await dispatchImmediateOutbox(db, {
          eventType: 'chat',
          eventId: messageId,
          limit: 100,
          timeoutMs: 3500
        });
      }
    } catch (pushErr) {
      console.warn('[PUSH-CHAT] Push Dispatch Error:', pushErr.message);
    }

    if (newMsg) {
      if (clientId) newMsg.clientId = clientId;
      sendBroadcast('new_message', newMsg);
    }

    if (clientId && newMsg) {
      recentClientMessages.set(clientId, { messageId, data: newMsg, timestamp: Date.now() });
      if (recentClientMessages.size > 200) {
        const cutoff = Date.now() - 60000;
        for (const [key, val] of recentClientMessages.entries()) {
          if (val.timestamp < cutoff) recentClientMessages.delete(key);
        }
      }
    }

    res.json({ message: 'Sent', messageId, data: newMsg, clientId });
  } catch (error) {
    if (file) fs.unlink(file.path, () => {});
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

    // Clean up physical attachment file and persistent blob
    if (msg.attachmentName) {
      const attFilename = path.basename(msg.attachmentName);
      const attPath = path.join(UPLOAD_DIR, attFilename);
      if (isSafeUploadPath(attPath) && fs.existsSync(attPath)) {
        try { fs.unlinkSync(attPath); } catch (_) {}
      }
      await db.deleteFileBlob(attFilename).catch(() => {});
    }

    const wasPinned = await db.get('SELECT id FROM chat_pinned WHERE messageId = ?', messageId);
    await db.run('DELETE FROM chat_pinned WHERE messageId = ?', messageId);
    if (wasPinned) await sendBroadcast('pin_message', { unpinned: true });

    // Clean up foreign references & reactions
    await db.run('UPDATE chat_messages SET replyToId = NULL WHERE replyToId = ?', messageId);
    await db.run('DELETE FROM chat_reactions WHERE messageId = ?', messageId);
    await db.run('DELETE FROM chat_messages WHERE id = ?', messageId);

    // Broadcast message deletion to all clients
    await sendBroadcast('delete_message', { messageId });

    res.json({ success: true, messageId });
  } catch (error) {
    console.error('Delete chat message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

app.get('/api/chat/attachment/:filename', requireLogin, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  // Ensure this file actually belongs to a chat message attachment
  const msg = await db.get(
    'SELECT id, attachmentMimeType, attachmentOriginalName FROM chat_messages WHERE attachmentName = ? LIMIT 1',
    filename
  );
  if (!msg) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  const filePath = await ensureLocalFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (msg.attachmentMimeType) {
    res.setHeader('Content-Type', msg.attachmentMimeType);
  }
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(filePath);
});
} // end legacy chat fallback

// ============================================================
// NOTIFICATION SYSTEM & CENTER
// ============================================================

app.use('/api/notifications', require('./routes/notifications')(db, requireLogin));

function verifyInternalCron(req, res, next) {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== 'production') {
    return next();
  }
  const authHeader = req.headers['authorization'];
  const cronHeader = req.headers['x-cron-secret'];
  if (secret && ((authHeader && authHeader === `Bearer ${secret}`) || (cronHeader && cronHeader === secret))) {
    return next();
  }
  return res.status(401).json({ message: 'Unauthorized internal worker request.' });
}

app.all(['/api/internal/push/process', '/api/internal/push/worker'], verifyInternalCron, async (req, res) => {
  try {
    const outboxResult = await pushNotifications.processPushOutbox(db, { limit: req.body?.limit || 100 });
    let receiptResult = null;
    if (req.method === 'GET' || req.body?.includeReceipts || req.headers['x-vercel-cron']) {
      receiptResult = await pushNotifications.processPushReceipts(db, { limit: 100 }).catch(() => null);
    }
    return res.json({ success: true, ...outboxResult, receipts: receiptResult });
  } catch (err) {
    console.error('[Push Outbox Process Worker Error]:', err.message);
    return res.status(500).json({ message: 'Push outbox processing failed.', error: err.message });
  }
});

app.all('/api/internal/push/receipts', verifyInternalCron, async (req, res) => {
  try {
    const result = await pushNotifications.processPushReceipts(db, {
      minAgeSeconds: req.body?.minAgeSeconds,
      limit: req.body?.limit
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Push Receipts Worker Error]:', err.message);
    return res.status(500).json({ message: 'Push receipts processing failed.', error: err.message });
  }
});

app.all('/api/internal/posts/cleanup-staging', verifyInternalCron, async (req, res) => {
  try {
    const ttlHours = req.query?.ttlHours !== undefined ? Number(req.query.ttlHours) : (req.body?.ttlHours !== undefined ? Number(req.body.ttlHours) : 24);
    const { cleanupAbandonedStagedAttachments } = require('./lib/posts');
    const POST_UPLOAD_DIR = process.env.VERCEL
      ? path.join('/tmp', 'uploads', 'posts')
      : path.join(__dirname, 'public', 'uploads', 'posts');
    const result = await cleanupAbandonedStagedAttachments(db, { ttlHours, uploadDir: POST_UPLOAD_DIR });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Cleanup Staging Worker Error]:', err.message);
    return res.status(500).json({ message: 'Staging cleanup failed.', error: err.message });
  }
});

// KYANA AI 3.0 Internal Knowledge Sync & Reconciliation
app.use('/api/internal/knowledge', require('./routes/internal-knowledge'));
// ============================================================
// PROFILE & SOCIAL GRAPH SYSTEM
// ============================================================

// Multer storage for student profile avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId || 'unknown';
    cb(null, `avatar_${studentId}_${Date.now()}${ext}`);
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

// Multer storage for student profile cover photos
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId || 'unknown';
    cb(null, `cover_${studentId}_${Date.now()}${ext}`);
  }
});

const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed as cover photos.'));
    }
  }
});

// Helper function to fetch profile with stats and privacy boundary
async function getStudentProfile(targetStudentId, viewerStudentId) {
  let student = await db.get(`
    SELECT studentId, username, name,
      CASE WHEN avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || studentId || '?v=' || LENGTH(avatarUrl) || '-' || SUBSTR(avatarUrl, -12) ELSE avatarUrl END AS avatarUrl,
      coverUrl, coverPosition, bio, department, semester, cohort_id, githubUrl, linkedinUrl, role, verification_status, email
    FROM students
    WHERE studentId = ?
  `, targetStudentId);

  if (!student && targetStudentId) {
    student = await db.get(`
      SELECT studentId, username, name,
        CASE WHEN avatarUrl LIKE 'data:%' THEN '/api/avatar/student/' || studentId || '?v=' || LENGTH(avatarUrl) || '-' || SUBSTR(avatarUrl, -12) ELSE avatarUrl END AS avatarUrl,
        coverUrl, coverPosition, bio, department, semester, cohort_id, githubUrl, linkedinUrl, role, verification_status, email
      FROM students
      WHERE LOWER(username) = LOWER(?)
    `, String(targetStudentId));
  }

  if (!student) return null;

  const actualStudentId = student.studentId;
  const isSelf = String(actualStudentId) === String(viewerStudentId);
  const role = student.role || 'student';
  const canCreateAssignments = role === 'admin' || role === 'teacher' || role === 'cr' || role === 'class_rep';

  const [statsRow, photosCountRow, subjects] = await Promise.all([
    db.get(`
      SELECT
        (SELECT COUNT(*) FROM files WHERE uploadedBy = ?) AS files_count,
        (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts_count,
        (SELECT COUNT(*) FROM assignments WHERE createdBy = ?) AS assignments_count,
        (SELECT COUNT(*) FROM file_likes JOIN files ON files.id = file_likes.fileId WHERE files.uploadedBy = ?) AS likes_received,
        (SELECT COUNT(*) FROM follows WHERE followingId = ?) AS followers_count,
        (SELECT COUNT(*) FROM follows WHERE followerId = ?) AS following_count,
        ${!isSelf ? 'EXISTS(SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?)' : '0'} AS is_following
    `, ...(isSelf
      ? [actualStudentId, actualStudentId, targetStudentId, targetStudentId, targetStudentId, targetStudentId]
      : [actualStudentId, actualStudentId, targetStudentId, targetStudentId, targetStudentId, targetStudentId, viewerStudentId, targetStudentId]
    )),
    db.get(`
      SELECT COUNT(*) AS c
      FROM post_media pm
      JOIN posts p ON p.id = pm.post_id
      WHERE p.user_id = ? AND (pm.media_type = 'image' OR pm.mime_type LIKE 'image/%')
    `, targetStudentId).catch(() => ({ c: 0 })),
    role === 'teacher'
      ? (async () => {
          try {
            const { getTeacherSubjects } = require('./lib/teacher-service');
            return await getTeacherSubjects(db, actualStudentId);
          } catch (_) { return []; }
        })()
      : Promise.resolve([])
  ]);

  const filesCount = Number(statsRow?.files_count ?? statsRow?.filescount ?? 0);
  const postsCount = Number(statsRow?.posts_count ?? statsRow?.postscount ?? 0);
  const photosCount = Number(photosCountRow?.c || photosCountRow?.count || 0);
  const assignmentsCount = Number(statsRow?.assignments_count ?? statsRow?.assignmentscount ?? 0);
  const likesReceived = Number(statsRow?.likes_received ?? statsRow?.likesreceived ?? 0);
  const followersCount = Number(statsRow?.followers_count ?? statsRow?.followerscount ?? 0);
  const followingCount = Number(statsRow?.following_count ?? statsRow?.followingcount ?? 0);
  const followCheck = !isSelf && Boolean(statsRow?.is_following ?? statsRow?.isfollowing);

  return {
    studentId: student.studentId,
    username: student.username || null,
    name: student.name,
    // PRIVACY BOUNDARY: never expose email, auth, or private fields to other users
    email: isSelf ? (student.email || null) : undefined,
    avatarUrl: student.avatarUrl || null,
    coverUrl: student.coverUrl || null,
    coverPosition: student.coverPosition || null,
    bio: student.bio || '',
    department: student.department || 'BIT',
    semester: role === 'teacher' ? null : (student.semester || 'Semester 1'),
    cohortId: role === 'teacher' ? null : (student.cohort_id || null),
    githubUrl: student.githubUrl || '',
    linkedinUrl: student.linkedinUrl || '',
    role,
    isAdmin: role === 'admin',
    isCR: role === 'cr' || role === 'class_rep',
    canCreateAssignments,
    subjects,
    verificationStatus: student.verification_status || student.verificationStatus || 'unverified',
    stats: {
      filesCount,
      postsCount,
      photosCount,
      assignmentsCount,
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
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const profile = await getStudentProfile(activeStudentId, activeStudentId);
  if (!profile) return res.status(404).json({ message: 'Profile not found' });
  return res.json(profile);
});

// Middleware: Enforce Teacher or Administrator access
async function requireTeacherOrAdmin(req, res, next) {
  if (req.isSuspended || req.user?.account_status === 'suspended' || req.user?.accountStatus === 'suspended') {
    return res.status(403).json({
      error: 'ACCOUNT_SUSPENDED',
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your account has been suspended by an administrator. Please contact support.'
    });
  }
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  if (!activeStudentId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  const role = req.session?.role || req.user?.role || req.student?.role;
  if (role === 'teacher' || role === 'admin') {
    return next();
  }
  try {
    const user = await db.get('SELECT role FROM students WHERE studentId = ?', activeStudentId);
    if (user && (user.role === 'teacher' || user.role === 'admin')) {
      return next();
    }
  } catch (_) {}
  return res.status(403).json({ message: 'Access denied: Teacher or administrator account required.' });
}

// Teacher Dashboard Initialization
app.get('/api/teacher/dashboard-init', requireLogin, requireTeacherOrAdmin, async (req, res) => {
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  try {
    const { getTeacherSubjects } = require('./lib/teacher-service');
    const [teacherProfile, subjects, notesCountRow, assignmentsCountRow] = await Promise.all([
      db.get(`
        SELECT s.studentId, s.name, s.email, s.role, s.department, s.avatarUrl,
               COALESCE(t.designation, 'Instructor') AS designation,
               t.id AS teacherId
        FROM students s
        LEFT JOIN teachers t ON (t.user_id = s.studentId OR t.id = s.studentId)
        WHERE s.studentId = ?
      `, activeStudentId),
      getTeacherSubjects(db, activeStudentId),
      db.get('SELECT COUNT(*) AS count FROM files WHERE uploadedBy = ?', activeStudentId),
      db.get('SELECT COUNT(*) AS count FROM assignments WHERE createdBy = ?', activeStudentId)
    ]);

    const assignedSemesters = Array.from(new Set((subjects || []).map(s => Number(s.semester)).filter(n => Number.isInteger(n) && n > 0))).sort((a, b) => a - b);
    res.json({
      user: {
        studentId: teacherProfile?.studentId || activeStudentId,
        name: teacherProfile?.name || 'Faculty Member',
        email: teacherProfile?.email || '',
        role: teacherProfile?.role || 'teacher',
        department: teacherProfile?.department || 'BIT'
      },
      teacher: teacherProfile || { studentId: activeStudentId, role: 'teacher' },
      assignedSubjects: subjects || [],
      assignedSemesters,
      subjects: subjects || [],
      stats: {
        assignedSubjectsCount: (subjects || []).length,
        uploadedNotesCount: Number(notesCountRow?.count || 0),
        createdAssignmentsCount: Number(assignmentsCountRow?.count || 0),
        subjectsCount: (subjects || []).length,
        notesCount: Number(notesCountRow?.count || 0),
        assignmentsCount: Number(assignmentsCountRow?.count || 0)
      }
    });
  } catch (err) {
    console.error('[Teacher Dashboard Init Error]:', err);
    res.status(500).json({ message: 'Failed to initialize teacher dashboard.' });
  }
});

// Get faculty assigned subjects
app.get('/api/teacher/subjects', requireLogin, requireTeacherOrAdmin, async (req, res) => {
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  try {
    const { getTeacherSubjects } = require('./lib/teacher-service');
    const subjects = await getTeacherSubjects(db, activeStudentId);
    res.json({ subjects: subjects || [] });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load faculty subjects.' });
  }
});

// Teacher My Notes (only notes uploaded by this teacher)
app.get('/api/teacher/notes', requireLogin, requireTeacherOrAdmin, async (req, res) => {
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const subjectFilter = req.query.subject ? String(req.query.subject).trim() : null;

  try {
    let query = `
      SELECT id, originalName, storedName, title, subject, chapter, semester,
             uploadedBy, uploadedAt, sizeBytes, previewName, audience_scope, semester_no, cohort_id
      FROM files
      WHERE uploadedBy = ?
    `;
    const params = [activeStudentId];

    if (subjectFilter && subjectFilter !== 'all') {
      query += ' AND LOWER(subject) = LOWER(?)';
      params.push(subjectFilter);
    }

    query += ' ORDER BY uploadedAt DESC';

    const notes = await db.all(query, ...params);
    res.json({ notes: notes || [] });
  } catch (err) {
    console.error('[Teacher Notes API Error]:', err);
    res.status(500).json({ message: 'Failed to load teacher notes.' });
  }
});

// Teacher My Assignments (only assignments created by this teacher)
app.get('/api/teacher/assignments', requireLogin, requireTeacherOrAdmin, async (req, res) => {
  const activeStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const subjectFilter = req.query.subject ? String(req.query.subject).trim() : null;

  try {
    let query = `
      SELECT a.*,
        a.createdBy AS created_by,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questions_count,
        (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissionCount,
        (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissions_count
      FROM assignments a
      WHERE a.createdBy = ?
    `;
    const params = [activeStudentId];

    if (subjectFilter && subjectFilter !== 'all') {
      query += ' AND LOWER(a.subject) = LOWER(?)';
      params.push(subjectFilter);
    }

    query += ' ORDER BY a.createdAt DESC';

    const assignments = await db.all(query, ...params);
    res.json({ assignments: assignments || [] });
  } catch (err) {
    console.error('[Teacher Assignments API Error]:', err);
    res.status(500).json({ message: 'Failed to load teacher assignments.' });
  }
});

// Get any student's profile by ID
app.get('/api/profile/:studentId', requireLogin, async (req, res) => {
  const viewerStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const profile = await getStudentProfile(req.params.studentId, viewerStudentId);
  if (!profile) return res.status(404).json({ message: 'Student profile not found' });
  res.json(profile);
});

function isValidImageBuffer(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 4) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WEBP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}

function isSafeWebUrl(u) {
  if (!u) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Update profile details
app.post('/api/profile/update', requireLogin, async (req, res) => {
  const { name, bio, department, semester, githubUrl, linkedinUrl } = req.body;
  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;

  const current = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
  if (!current) return res.status(404).json({ message: 'Student not found' });

  if (githubUrl && !isSafeWebUrl(githubUrl.trim())) {
    return res.status(400).json({ message: 'Invalid GitHub URL. Must start with http:// or https://' });
  }
  if (linkedinUrl && !isSafeWebUrl(linkedinUrl.trim())) {
    return res.status(400).json({ message: 'Invalid LinkedIn URL. Must start with http:// or https://' });
  }

  const updatedName = (name && name.trim()) ? name.trim().slice(0, 100) : current.name;
  const updatedBio = typeof bio === 'string' ? bio.trim().slice(0, 300) : (current.bio || '');
  const updatedDept = (department && department.trim()) ? department.trim().slice(0, 50) : (current.department || 'BIT');
  const isAdmin = (req.user && req.user.role === 'admin') || (req.session && req.session.role === 'admin');
  const updatedSem = (isAdmin && semester && semester.trim()) ? semester.trim().slice(0, 30) : (current.semester || 'Semester 1');
  const updatedGithub = typeof githubUrl === 'string' ? githubUrl.trim().slice(0, 150) : (current.githubUrl || '');
  const updatedLinkedin = typeof linkedinUrl === 'string' ? linkedinUrl.trim().slice(0, 150) : (current.linkedinUrl || '');

  await db.run(`
    UPDATE students
    SET name = ?, bio = ?, department = ?, semester = ?, githubUrl = ?, linkedinUrl = ?
    WHERE studentId = ?
  `, updatedName, updatedBio, updatedDept, updatedSem, updatedGithub, updatedLinkedin, studentId);

  // Update session name if changed
  if (req.session) {
    req.session.studentName = updatedName;
  }

  const profile = await getStudentProfile(studentId, studentId);
  res.json({ message: 'Profile updated successfully', profile });
});

// Upload profile avatar picture
app.post('/api/profile/avatar', requireLogin, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded.' });
  }

  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const filePath = req.file.path;

  // Validate magic bytes to prevent uploaded HTML/SVG from masquerading as image
  let fileBuf;
  try {
    fileBuf = fs.readFileSync(filePath);
  } catch (err) {
    return res.status(400).json({ message: 'Could not read uploaded avatar file.' });
  }

  if (!isValidImageBuffer(fileBuf)) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(400).json({ message: 'Invalid image format. Only real JPEG, PNG, GIF, or WebP images are allowed.' });
  }

  const avatarUrl = `/api/avatar/${req.file.filename}`;

  // Save to persistent blob storage — must not report success if saving failed
  try {
    await db.saveFileBlob(req.file.filename, fileBuf, req.file.mimetype || 'image/jpeg');
  } catch (err) {
    console.error('[Avatar Blob Save Error]:', err.message);
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(500).json({ message: 'Failed to securely store avatar. Please try again.' });
  }

  const current = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentId);
  const oldAvatarUrl = current?.avatarUrl;

  try {
    await db.run('UPDATE students SET avatarUrl = ? WHERE studentId = ?', avatarUrl, studentId);
  } catch (dbErr) {
    console.error('[Avatar DB Update Error]:', dbErr.message);
    try { fs.unlinkSync(filePath); } catch (_) {}
    await db.deleteFileBlob(req.file.filename).catch(() => {});
    return res.status(500).json({ message: 'Failed to update profile picture record.' });
  }

  // DB update succeeded — clean up previous avatar file and blob if replacing an existing custom avatar
  try {
    if (oldAvatarUrl && oldAvatarUrl.startsWith('/api/avatar/')) {
      const oldFilename = path.basename(oldAvatarUrl);
      if (oldFilename && oldFilename !== req.file.filename) {
        const oldPath = path.join(UPLOAD_DIR, oldFilename);
        if (isSafeUploadPath(oldPath) && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
        await db.deleteFileBlob(oldFilename).catch(() => {});
      }
    }
  } catch (cleanupErr) {
    console.warn('[Avatar Cleanup Warning]:', cleanupErr.message);
  }

  res.json({ message: 'Profile picture updated successfully', avatarUrl });
});

// Serve inline base64 student avatar as binary image with long cache headers
app.get('/api/avatar/student/:studentId', async (req, res) => {
  try {
    const sid = String(req.params.studentId || '').trim();
    if (!sid) return res.status(404).end();
    const row = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', sid);
    const url = row && (row.avatarUrl || row.avatarurl);
    if (!url) return res.status(404).end();
    if (url.startsWith('data:image/')) {
      const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(url);
      if (!match) return res.status(404).end();
      const buf = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', match[1]);
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buf);
    }
    return res.redirect(302, url);
  } catch (_) {
    return res.status(404).end();
  }
});

// Serve avatar image safely — only serve files that actually belong to an avatar in students
app.get('/api/avatar/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return res.status(404).json({ message: 'Avatar image not found' });
  }

  // Enforce access control: verify this file is linked to a student avatar
  const student = await db.get(
    'SELECT studentId FROM students WHERE avatarUrl = ? OR avatarUrl = ? OR avatarUrl LIKE ? LIMIT 1',
    `/api/avatar/${filename}`,
    filename,
    `%/${filename}`
  );

  if (!student) {
    return res.status(404).json({ message: 'Avatar image not found' });
  }

  const filePath = await ensureLocalFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Avatar image not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(filePath);
});

// Remove profile avatar picture
app.delete('/api/profile/avatar', requireLogin, async (req, res) => {
  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  if (!studentId) return res.status(401).json({ message: 'Authentication required' });

  try {
    const current = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentId);
    if (current && current.avatarUrl && current.avatarUrl.startsWith('/api/avatar/')) {
      const oldFilename = path.basename(current.avatarUrl);
      if (oldFilename) {
        const oldPath = path.join(UPLOAD_DIR, oldFilename);
        if (isSafeUploadPath(oldPath) && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
        await db.deleteFileBlob(oldFilename).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Avatar Remove Warning]:', err.message);
  }

  await db.run('UPDATE students SET avatarUrl = NULL WHERE studentId = ?', studentId);
  res.json({ message: 'Profile picture removed successfully', avatarUrl: null });
});

// Upload profile cover photo
app.post('/api/profile/cover', requireLogin, uploadCover.single('cover'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded.' });
  }

  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  if (!studentId) return res.status(401).json({ message: 'Authentication required' });

  const filePath = req.file.path;

  let fileBuf;
  try {
    fileBuf = fs.readFileSync(filePath);
  } catch (err) {
    return res.status(400).json({ message: 'Could not read uploaded cover file.' });
  }

  if (!isValidImageBuffer(fileBuf)) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(400).json({ message: 'Invalid image format. Only real JPEG, PNG, GIF, or WebP images are allowed.' });
  }

  const coverUrl = `/api/cover/${req.file.filename}`;

  try {
    await db.saveFileBlob(req.file.filename, fileBuf, req.file.mimetype || 'image/jpeg');
  } catch (err) {
    console.error('[Cover Blob Save Error]:', err.message);
    try { fs.unlinkSync(filePath); } catch (_) {}
    return res.status(500).json({ message: 'Failed to securely store cover photo. Please try again.' });
  }

  const current = await db.get('SELECT coverUrl AS cu FROM students WHERE studentId = ?', studentId);
  const oldCoverUrl = current?.cu;
  const coverPosition = req.body.coverPosition || (req.body.position ? JSON.stringify(req.body.position) : null);

  try {
    await db.run('UPDATE students SET coverUrl = ?, coverPosition = ? WHERE studentId = ?', coverUrl, coverPosition, studentId);
  } catch (dbErr) {
    console.error('[Cover DB Update Error]:', dbErr.message);
    try { fs.unlinkSync(filePath); } catch (_) {}
    await db.deleteFileBlob(req.file.filename).catch(() => {});
    return res.status(500).json({ message: 'Failed to update cover photo record.' });
  }

  // DB update succeeded — clean up previous cover photo file and blob if replacing
  try {
    if (oldCoverUrl && oldCoverUrl.startsWith('/api/cover/')) {
      const oldFilename = path.basename(oldCoverUrl);
      if (oldFilename && oldFilename !== req.file.filename) {
        const oldPath = path.join(UPLOAD_DIR, oldFilename);
        if (isSafeUploadPath(oldPath) && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
        await db.deleteFileBlob(oldFilename).catch(() => {});
      }
    }
  } catch (cleanupErr) {
    console.warn('[Cover Cleanup Warning]:', cleanupErr.message);
  }

  res.json({ message: 'Cover photo updated successfully', coverUrl, coverPosition });
});

// Update cover photo reposition
app.post('/api/profile/cover/position', requireLogin, async (req, res) => {
  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  if (!studentId) return res.status(401).json({ message: 'Authentication required' });

  const pos = req.body.coverPosition || (req.body.position ? JSON.stringify(req.body.position) : null);
  await db.run('UPDATE students SET coverPosition = ? WHERE studentId = ?', pos, studentId);
  res.json({ message: 'Cover position updated successfully', coverPosition: pos });
});

// Remove profile cover photo
app.delete('/api/profile/cover', requireLogin, async (req, res) => {
  const studentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  if (!studentId) return res.status(401).json({ message: 'Authentication required' });

  try {
    const current = await db.get('SELECT coverUrl AS cu FROM students WHERE studentId = ?', studentId);
    if (current && current.cu && current.cu.startsWith('/api/cover/')) {
      const oldFilename = path.basename(current.cu);
      if (oldFilename) {
        const oldPath = path.join(UPLOAD_DIR, oldFilename);
        if (isSafeUploadPath(oldPath) && fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (_) {}
        }
        await db.deleteFileBlob(oldFilename).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Cover Remove Warning]:', err.message);
  }

  await db.run('UPDATE students SET coverUrl = NULL, coverPosition = NULL WHERE studentId = ?', studentId);
  res.json({ message: 'Cover photo removed successfully', coverUrl: null });
});

// Serve cover image safely — only serve files that actually belong to a coverUrl in students
app.get('/api/cover/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return res.status(404).json({ message: 'Cover image not found' });
  }

  const student = await db.get(
    'SELECT studentId FROM students WHERE coverUrl = ? OR coverUrl = ? OR coverUrl LIKE ? LIMIT 1',
    `/api/cover/${filename}`,
    filename,
    `%/${filename}`
  );

  if (!student) {
    return res.status(404).json({ message: 'Cover image not found' });
  }

  const filePath = await ensureLocalFile(filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Cover image not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(filePath);
});

// Get photos uploaded by a student through posts
app.get('/api/profile/:studentId/photos', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  const { isModerationSchemaAvailable } = require('./lib/posts');
  const modAvail = await isModerationSchemaAvailable(db);
  const modFilter = modAvail ? " AND (p.moderation_status IS NULL OR p.moderation_status = 'active')" : '';

  let mediaPhotos = [];
  try {
    mediaPhotos = await db.all(`
      SELECT pm.id, pm.post_id AS "postId", pm.url, pm.file_name AS "fileName", pm.file_size AS "fileSize",
        pm.created_at AS "createdAt", p.content AS "postContent"
      FROM post_media pm
      JOIN posts p ON p.id = pm.post_id
      WHERE p.user_id = ?${modFilter} AND (pm.media_type = 'image' OR pm.mime_type LIKE 'image/%')
      ORDER BY pm.id DESC
      LIMIT 100
    `, targetStudentId);
  } catch (err) {
    console.warn('[Profile Photos post_media query error]:', err.message);
  }

  let legacyPhotos = [];
  try {
    legacyPhotos = await db.all(`
      SELECT p.id AS "postId", p.attachment_url AS "url", p.created_at AS "createdAt", p.content AS "postContent"
      FROM posts p
      WHERE p.user_id = ?${modFilter} AND p.attachment_url IS NOT NULL AND (
        p.attachment_url LIKE '%.png' OR p.attachment_url LIKE '%.jpg' OR
        p.attachment_url LIKE '%.jpeg' OR p.attachment_url LIKE '%.webp' OR
        p.attachment_url LIKE '%.gif'
      )
      ORDER BY p.id DESC
      LIMIT 100
    `, targetStudentId);
  } catch (err) {
    console.warn('[Profile Photos legacy query error]:', err.message);
  }

  const seen = new Set();
  const photos = [];
  for (const item of [...mediaPhotos, ...legacyPhotos]) {
    if (item && item.url && !seen.has(item.url)) {
      seen.add(item.url);
      photos.push({
        id: item.id || `legacy_${item.postId}`,
        postId: item.postId,
        url: item.url,
        fileName: item.fileName || path.basename(item.url),
        fileSize: Number(item.fileSize || 0),
        createdAt: item.createdAt,
        postContent: item.postContent
      });
    }
  }

  res.json(photos);
});

// Get assignments created by a student (if authorized role)
app.get('/api/profile/:studentId/assignments', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  try {
    const assignments = await db.all(`
      SELECT a.id, a.title, a.description, a.language, a.subject, a.semester, a.deadline,
        a.pdfUrl, a.pdfName, a.createdBy, a.createdAt,
        (SELECT COUNT(*) FROM submissions sub WHERE sub.assignmentId = a.id) AS "submissionCount"
      FROM assignments a
      WHERE a.createdBy = ?
      ORDER BY a.createdAt DESC
    `, targetStudentId);
    res.json(assignments);
  } catch (err) {
    console.warn('[Profile Assignments error]:', err.message);
    res.json([]);
  }
});

// Toggle/set follow/unfollow a student (retry-safe)
app.post('/api/profile/:studentId/follow', requireLogin, async (req, res) => {
  const followerId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
  const followingId = req.params.studentId;
  const explicitAction = req.body && (req.body.action || (typeof req.body.following === 'boolean' ? (req.body.following ? 'follow' : 'unfollow') : null));

  if (followerId === followingId) {
    return res.status(400).json({ message: 'You cannot follow yourself.' });
  }

  const target = await db.get('SELECT studentId FROM students WHERE studentId = ?', followingId);
  if (!target) return res.status(404).json({ message: 'Student not found.' });

  const existing = await db.get('SELECT 1 FROM follows WHERE followerId = ? AND followingId = ?', followerId, followingId);
  let shouldFollow;

  if (explicitAction === 'follow') {
    shouldFollow = true;
  } else if (explicitAction === 'unfollow') {
    shouldFollow = false;
  } else {
    shouldFollow = !existing;
  }

  if (shouldFollow) {
    if (!existing) {
      if (db.isPostgres) {
        await db.run('INSERT INTO follows (followerId, followingId, createdAt) VALUES (?, ?, ?) ON CONFLICT (followerId, followingId) DO NOTHING', followerId, followingId, new Date().toISOString());
      } else {
        await db.run('INSERT OR IGNORE INTO follows (followerId, followingId, createdAt) VALUES (?, ?, ?)', followerId, followingId, new Date().toISOString());
      }
    }
  } else {
    if (existing) {
      await db.run('DELETE FROM follows WHERE followerId = ? AND followingId = ?', followerId, followingId);
    }
  }

  const countRow = await db.get('SELECT COUNT(*) AS c FROM follows WHERE followingId = ?', followingId);
  const followersCount = Number(countRow?.c || countRow?.count || 0);
  res.json({ isFollowing: shouldFollow, followersCount });
});

// List followers of a student
app.get('/api/profile/:studentId/followers', requireLogin, async (req, res) => {
  const targetStudentId = req.params.studentId;
  const viewerStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;

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
  const viewerStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;

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
  const viewerStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;
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
  const viewerStudentId = req.session?.studentId || req.user?.studentId || req.student?.studentId;

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
const aiChatService = require('./lib/ai-chat-service');

// Unlimited AI Chat: Users can chat with Kyana without message caps or rate limits
app.post('/api/ai/chat', require('./lib/chat-http').createChatHandler(db, aiAssistant));

// Kyana AI inbox preview for mobile chat list and web widget
app.get('/api/ai/preview', async (req, res) => {
  try {
    const studentId = req.user?.studentId || req.student?.studentId || req.session?.studentId || null;
    const preview = await aiChatService.getInboxPreview(db, studentId);
    res.json(preview);
  } catch (err) {
    res.json({
      conversationId: null,
      title: 'Kyana AI',
      subtitle: 'How can I help you today?',
      timestamp: null,
      unreadCount: 0,
      isPinned: true
    });
  }
});

app.get('/api/ai/resources/:type/:id/open', requireLogin, require('./lib/kyana-resource-http').createResourceHandler(db));

// Authenticated AI Conversation Endpoints
app.get('/api/ai/conversations', requireLogin, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    const convs = await aiChatService.getConversations(db, studentId);
    res.json(convs);
  } catch (err) {
    console.error('[AI Conversations API Error]:', err);
    res.status(500).json({ message: 'Failed to retrieve AI conversations.' });
  }
});

app.get('/api/ai/conversations/:id/messages', requireLogin, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    const convId = req.params.id;
    const conv = await aiChatService.getConversation(db, studentId, convId);
    if (!conv) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const messages = await aiChatService.getMessages(db, studentId, convId, 100);
    res.json({ conversation: conv, messages });
  } catch (err) {
    console.error('[AI Conversation Messages API Error]:', err);
    res.status(500).json({ message: 'Failed to retrieve messages.' });
  }
});

app.post('/api/ai/conversations', requireLogin, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    const title = (req.body?.title || '').trim() || 'New conversation';
    const conv = await aiChatService.createConversation(db, studentId, title);
    res.status(201).json(conv);
  } catch (err) {
    console.error('[Create AI Conversation API Error]:', err);
    res.status(500).json({ message: 'Failed to create conversation.' });
  }
});

app.post('/api/ai/conversations/:id/clear', requireLogin, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    const convId = req.params.id;
    const ok = await aiChatService.clearConversation(db, studentId, convId);
    if (!ok) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    res.json({ success: true, message: 'Conversation cleared.' });
  } catch (err) {
    console.error('[Clear AI Conversation API Error]:', err);
    res.status(500).json({ message: 'Failed to clear conversation.' });
  }
});

app.delete('/api/ai/conversations/:id', requireLogin, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    const convId = req.params.id;
    const ok = await aiChatService.deleteConversation(db, studentId, convId);
    if (!ok) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    res.json({ success: true, message: 'Conversation deleted.' });
  } catch (err) {
    console.error('[Delete AI Conversation API Error]:', err);
    res.status(500).json({ message: 'Failed to delete conversation.' });
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

// --- Online Code Compiler (Local Execution via spawn) ---

// Resource constants
const COMPILE_TIMEOUT_MS = 10000;   // 10 s hard wall-clock limit
const OUTPUT_LIMIT_BYTES = 524288;  // 512 KB max combined output per stream

// Rate limiter: simple in-memory sliding-window (no external dep)
const _compileRateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const WINDOW = 60 * 1000; // 1 minute
  const MAX_REQS = 20;       // 20 runs/IP/minute
  const timestamps = (_compileRateMap.get(ip) || []).filter(t => now - t < WINDOW);
  if (timestamps.length >= MAX_REQS) return true;
  timestamps.push(now);
  _compileRateMap.set(ip, timestamps);
  return false;
}

function truncate(str, label) {
  if (Buffer.byteLength(str, 'utf8') <= OUTPUT_LIMIT_BYTES) return str;
  const truncated = Buffer.from(str, 'utf8').slice(0, OUTPUT_LIMIT_BYTES).toString('utf8');
  return truncated + `\n\n[${label} truncated — output exceeded ${OUTPUT_LIMIT_BYTES / 1024} KB]`;
}

function resolveStatus({ timedOut, isCompileError, success, hasNoPublicClass }) {
  if (hasNoPublicClass) return 'Error';
  if (timedOut) return 'Time Limit Exceeded';
  if (isCompileError) return 'Compilation Error';
  if (!success) return 'Runtime Error';
  return 'Success';
}

app.post('/api/compile', async (req, res) => {
  const runnerUrl = process.env.ISOLATED_RUNNER_URL;
  const allowLocal = process.env.ENABLE_LOCAL_COMPILER === 'true';

  if (!runnerUrl && !allowLocal) {
    return res.status(503).json({
      success: false,
      stdout: '',
      stderr: 'The direct server compiler is disabled by default for security. An isolated runner sandbox is required.',
      error: 'Compiler service unavailable.',
      status: 'Unavailable',
      executionTime: 0
    });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      success: false, stdout: '', stderr: '',
      error: 'Rate limit exceeded. Max 20 runs per minute per IP.',
      status: 'Error', executionTime: 0
    });
  }

  const { language, code, input } = req.body || {};

  if (!language || !code) {
    return res.status(400).json({
      success: false, stdout: '', stderr: '',
      error: 'Language and code are required.',
      status: 'Error', executionTime: 0
    });
  }

  const SUPPORTED = ['java', 'c', 'cpp', 'python'];
  if (!SUPPORTED.includes(language)) {
    return res.status(400).json({
      success: false, stdout: '', stderr: '',
      error: `Unsupported language: ${language}. Supported: ${SUPPORTED.join(', ')}.`,
      status: 'Error', executionTime: 0
    });
  }

  // Forward to isolated runner sandbox if configured
  if (runnerUrl) {
    try {
      const runnerRes = await fetch(runnerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code, input: input || '' }),
        signal: AbortSignal.timeout(15000)
      });
      const data = await runnerRes.json();
      return res.status(runnerRes.status).json(data);
    } catch (err) {
      return res.status(502).json({
        success: false,
        stdout: '',
        stderr: '',
        error: `Isolated compiler runner error: ${err.message}`,
        status: 'Error',
        executionTime: 0
      });
    }
  }

  // Local child-process execution ONLY permitted if ENABLE_LOCAL_COMPILER === 'true'
  if (!allowLocal) {
    return res.status(503).json({
      success: false,
      stdout: '',
      stderr: 'Local compilation execution is disabled.',
      error: 'Compiler service unavailable.',
      status: 'Unavailable',
      executionTime: 0
    });
  }

  const { spawn } = require('child_process');
  const { randomUUID } = require('crypto');
  const fs = require('fs');

  // Per-submission isolated temp directory
  const scratchBase = path.join(__dirname, 'scratch');
  if (!fs.existsSync(scratchBase)) fs.mkdirSync(scratchBase, { recursive: true });
  const sessionDir = path.join(scratchBase, randomUUID());
  fs.mkdirSync(sessionDir, { recursive: true });

  const startTime = Date.now();

  // Spawn helper — pipes stdin, collects stdout/stderr, enforces timeout + output cap
  function runProcess(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputCapped = false;

      const proc = spawn(cmd, args, { cwd: sessionDir, ...opts });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, COMPILE_TIMEOUT_MS);

      proc.stdout.on('data', chunk => {
        if (!outputCapped) {
          stdout += chunk.toString();
          if (Buffer.byteLength(stdout, 'utf8') > OUTPUT_LIMIT_BYTES) {
            outputCapped = true;
            proc.kill('SIGKILL');
          }
        }
      });

      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      if (input) proc.stdin.write(input);
      proc.stdin.end();

      proc.on('close', code => {
        clearTimeout(timer);
        resolve({
          code,
          stdout: truncate(stdout, 'stdout'),
          stderr: truncate(stderr, 'stderr'),
          timedOut,
          outputCapped
        });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: stderr + err.message, timedOut, outputCapped });
      });
    });
  }

  function cleanup() {
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) { }
  }

  try {
    let runResult = null;

    // ── Java ──────────────────────────────────────────────────
    if (language === 'java') {
      const classMatch = code.match(/public\s+class\s+(\w+)/);
      if (!classMatch) {
        cleanup();
        return res.json({
          success: false, stdout: '', stderr: '',
          error: 'No public class found in your Java code. Java requires a public class declaration (e.g. public class Main).',
          status: resolveStatus({ hasNoPublicClass: true }),
          executionTime: 0
        });
      }
      const className = classMatch[1];
      fs.writeFileSync(path.join(sessionDir, `${className}.java`), code, 'utf8');

      const compileResult = await runProcess('javac', [`${className}.java`]);
      if (compileResult.code !== 0 || compileResult.timedOut) {
        cleanup();
        return res.json({
          success: false,
          stdout: compileResult.stdout,
          stderr: compileResult.stderr || (compileResult.timedOut ? 'Compilation timed out.' : ''),
          error: compileResult.timedOut ? 'Compilation timed out.' : 'Compilation failed.',
          status: resolveStatus({ timedOut: compileResult.timedOut, isCompileError: true }),
          executionTime: Date.now() - startTime
        });
      }

      runResult = await runProcess('java', [className]);

      // ── C ──────────────────────────────────────────────────────
    } else if (language === 'c') {
      fs.writeFileSync(path.join(sessionDir, 'file.c'), code, 'utf8');

      const compileResult = await runProcess('gcc', ['file.c', '-o', 'out', '-lm']);
      if (compileResult.code !== 0 || compileResult.timedOut) {
        cleanup();
        return res.json({
          success: false,
          stdout: compileResult.stdout,
          stderr: compileResult.stderr || (compileResult.timedOut ? 'Compilation timed out.' : ''),
          error: compileResult.timedOut ? 'Compilation timed out.' : 'Compilation failed.',
          status: resolveStatus({ timedOut: compileResult.timedOut, isCompileError: true }),
          executionTime: Date.now() - startTime
        });
      }

      runResult = await runProcess('./out', []);

      // ── C++ ────────────────────────────────────────────────────
    } else if (language === 'cpp') {
      fs.writeFileSync(path.join(sessionDir, 'file.cpp'), code, 'utf8');

      const compileResult = await runProcess('g++', ['file.cpp', '-o', 'out', '-lm', '-std=c++17']);
      if (compileResult.code !== 0 || compileResult.timedOut) {
        cleanup();
        return res.json({
          success: false,
          stdout: compileResult.stdout,
          stderr: compileResult.stderr || (compileResult.timedOut ? 'Compilation timed out.' : ''),
          error: compileResult.timedOut ? 'Compilation timed out.' : 'Compilation failed.',
          status: resolveStatus({ timedOut: compileResult.timedOut, isCompileError: true }),
          executionTime: Date.now() - startTime
        });
      }

      runResult = await runProcess('./out', []);

      // ── Python ────────────────────────────────────────────────
    } else if (language === 'python') {
      fs.writeFileSync(path.join(sessionDir, 'file.py'), code, 'utf8');
      runResult = await runProcess('python3', ['file.py']);
    }

    cleanup();
    const elapsed = Date.now() - startTime;
    const timedOut = runResult.timedOut;
    const outputCapped = runResult.outputCapped;
    const success = runResult.code === 0 && !timedOut;

    let error = null;
    if (timedOut) error = 'Time limit exceeded (10s). Your program may have an infinite loop.';
    else if (outputCapped) error = 'Output truncated — program printed more than 512 KB.';
    else if (!success) error = 'Program exited with a non-zero status code.';

    return res.json({
      success,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      error,
      status: resolveStatus({ timedOut, success }),
      executionTime: elapsed
    });

  } catch (err) {
    cleanup();
    console.error('[Compile API Error]:', err.message);
    return res.json({
      success: false, stdout: '', stderr: '',
      error: 'Internal server error during code execution.',
      status: 'Error', executionTime: 0
    });
  }
});

// --- Global API Error Handler (Ensures all /api routes return JSON, never HTML) ---
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      message: err.message || 'An unexpected server error occurred.'
    });
  }
  if (req.accepts('html')) {
    return res.status(err.status || 500).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  next(err);
});

// --- Interactive Online Compiler Live WebSocket Server ---
function setupCompilerWebSocket(server) {
  const { WebSocketServer } = require('ws');
  const { spawn } = require('child_process');
  const { randomUUID } = require('crypto');
  const fs = require('fs');
  const path = require('path');

  const wss = new WebSocketServer({ server, path: '/api/compiler/live' });
  const activeSessionsByIp = new Map();

  const SESSION_TIMEOUT_MS = 30000;  // 30s session timeout
  const OUTPUT_LIMIT_BYTES = 524288; // 512 KB output cap

  wss.on('connection', (ws, req) => {
    const allowLocal = process.env.ENABLE_LOCAL_COMPILER === 'true';
    if (!allowLocal) {
      ws.send(JSON.stringify({
        type: 'stderr',
        data: '\r\n\x1b[33m[Compiler runner is currently disabled for maintenance. An isolated runner sandbox is required.]\x1b[0m\r\n'
      }));
      ws.send(JSON.stringify({ type: 'exit', code: 1, error: 'Compiler service unavailable' }));
      ws.close(1000, 'Compiler service unavailable');
      return;
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

    let sessions = activeSessionsByIp.get(clientIp);
    if (!sessions) {
      sessions = new Set();
      activeSessionsByIp.set(clientIp, sessions);
    }

    if (sessions.size >= 2) {
      ws.send(JSON.stringify({
        type: 'stderr',
        data: '\r\n\x1b[31m[Connection limit reached: Maximum 2 concurrent sessions allowed per IP.]\x1b[0m\r\n'
      }));
      ws.send(JSON.stringify({ type: 'exit', code: 1, error: 'Concurrent session limit exceeded' }));
      ws.close(1008, 'Max concurrent sessions');
      return;
    }

    sessions.add(ws);

    let proc = null;
    let sessionDir = null;
    let sessionTimeoutTimer = null;
    let totalOutputBytes = 0;
    let isRunning = false;
    let runStartTime = 0;

    function cleanup() {
      if (sessionTimeoutTimer) {
        clearTimeout(sessionTimeoutTimer);
        sessionTimeoutTimer = null;
      }
      if (proc) {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch (_) { }
        proc = null;
      }
      if (sessionDir) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (_) { }
        sessionDir = null;
      }
      isRunning = false;
    }

    ws.on('message', async (rawMsg) => {
      let msg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch (e) {
        return ws.send(JSON.stringify({ type: 'stderr', data: 'Invalid JSON message payload.\r\n' }));
      }

      if (msg.type === 'run') {
        if (isRunning) {
          return ws.send(JSON.stringify({ type: 'stderr', data: 'A program is already running in this session.\r\n' }));
        }

        const { language, code } = msg;
        const SUPPORTED = ['java', 'c', 'cpp', 'python'];
        if (!SUPPORTED.includes(language)) {
          ws.send(JSON.stringify({
            type: 'stderr',
            data: `Unsupported language: ${language}. Supported: ${SUPPORTED.join(', ')}.\r\n`
          }));
          ws.send(JSON.stringify({ type: 'exit', code: 1, error: 'Unsupported language' }));
          return;
        }

        if (!code || !code.trim()) {
          ws.send(JSON.stringify({ type: 'stderr', data: 'Code cannot be empty.\r\n' }));
          ws.send(JSON.stringify({ type: 'exit', code: 1, error: 'Empty code' }));
          return;
        }

        totalOutputBytes = 0;
        runStartTime = Date.now();

        const scratchBase = path.join(__dirname, 'scratch');
        if (!fs.existsSync(scratchBase)) fs.mkdirSync(scratchBase, { recursive: true });
        sessionDir = path.join(scratchBase, randomUUID());
        fs.mkdirSync(sessionDir, { recursive: true });

        const runCompile = (cmd, args) => {
          return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            const cProc = spawn(cmd, args, { cwd: sessionDir });
            const cTimer = setTimeout(() => {
              timedOut = true;
              cProc.kill('SIGKILL');
            }, 10000);

            cProc.stdout.on('data', d => { stdout += d.toString(); });
            cProc.stderr.on('data', d => { stderr += d.toString(); });
            cProc.on('close', code => {
              clearTimeout(cTimer);
              resolve({ code, stdout, stderr, timedOut });
            });
            cProc.on('error', err => {
              clearTimeout(cTimer);
              resolve({ code: -1, stdout, stderr: err.message, timedOut });
            });
          });
        };

        let runCmd = '';
        let runArgs = [];

        // ── Java ──────────────────────────────────────────
        if (language === 'java') {
          let className = null;
          const publicMatch = code.match(/public\s+class\s+([A-Za-z0-9_$]+)/);
          if (publicMatch) {
            className = publicMatch[1];
          } else {
            const anyClassMatch = code.match(/class\s+([A-Za-z0-9_$]+)/);
            if (anyClassMatch) {
              className = anyClassMatch[1];
            } else {
              className = 'Main';
            }
          }
          fs.writeFileSync(path.join(sessionDir, `${className}.java`), code, 'utf8');

          ws.send(JSON.stringify({ type: 'status', status: 'compiling', message: `Compiling ${className}.java...` }));
          const comp = await runCompile('javac', [`${className}.java`]);
          if (comp.code !== 0 || comp.timedOut) {
            let errMsg = comp.timedOut ? 'Compilation timed out.\r\n' : (comp.stderr || comp.stdout || 'Compilation failed.\r\n');
            if (errMsg.includes('Unable to locate a Java Runtime')) {
              errMsg += '\r\n\x1b[33mTip: Java JDK is not installed on this system. You can test C, C++, and Python right away, or install Java with: brew install openjdk\x1b[0m\r\n';
            }
            ws.send(JSON.stringify({ type: 'stderr', data: errMsg }));
            ws.send(JSON.stringify({ type: 'exit', code: comp.code || 1, isCompileError: true }));
            cleanup();
            return;
          }
          runCmd = 'java';
          runArgs = [className];

          // ── C ──────────────────────────────────────────────
        } else if (language === 'c') {
          fs.writeFileSync(path.join(sessionDir, 'file.c'), code, 'utf8');
          // Inject unbuffered stdout/stderr constructor so printf flushes immediately to terminal
          fs.writeFileSync(path.join(sessionDir, 'unbuffer.h'), `#include <stdio.h>\n__attribute__((constructor)) static void __init_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); setvbuf(stderr, NULL, _IONBF, 0); }\n`, 'utf8');

          ws.send(JSON.stringify({ type: 'status', status: 'compiling', message: 'Compiling C program...' }));
          const comp = await runCompile('gcc', ['-include', 'unbuffer.h', 'file.c', '-o', 'out', '-lm']);
          if (comp.code !== 0 || comp.timedOut) {
            const errMsg = comp.timedOut ? 'Compilation timed out.\r\n' : (comp.stderr || comp.stdout || 'Compilation failed.\r\n');
            ws.send(JSON.stringify({ type: 'stderr', data: errMsg }));
            ws.send(JSON.stringify({ type: 'exit', code: comp.code || 1, isCompileError: true }));
            cleanup();
            return;
          }
          runCmd = './out';
          runArgs = [];

          // ── C++ ────────────────────────────────────────────
        } else if (language === 'cpp') {
          fs.writeFileSync(path.join(sessionDir, 'file.cpp'), code, 'utf8');
          // Inject unbuffered stdout/stderr constructor so cout and printf flush immediately to terminal
          fs.writeFileSync(path.join(sessionDir, 'unbuffer.h'), `#include <stdio.h>\n#ifdef __cplusplus\nextern "C" {\n#endif\n__attribute__((constructor)) static void __init_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); setvbuf(stderr, NULL, _IONBF, 0); }\n#ifdef __cplusplus\n}\n#endif\n`, 'utf8');

          ws.send(JSON.stringify({ type: 'status', status: 'compiling', message: 'Compiling C++ program...' }));
          const comp = await runCompile('g++', ['-include', 'unbuffer.h', 'file.cpp', '-o', 'out', '-lm', '-std=c++17']);
          if (comp.code !== 0 || comp.timedOut) {
            const errMsg = comp.timedOut ? 'Compilation timed out.\r\n' : (comp.stderr || comp.stdout || 'Compilation failed.\r\n');
            ws.send(JSON.stringify({ type: 'stderr', data: errMsg }));
            ws.send(JSON.stringify({ type: 'exit', code: comp.code || 1, isCompileError: true }));
            cleanup();
            return;
          }
          runCmd = './out';
          runArgs = [];

          // ── Python ─────────────────────────────────────────
        } else if (language === 'python') {
          fs.writeFileSync(path.join(sessionDir, 'file.py'), code, 'utf8');
          runCmd = 'python3';
          runArgs = ['-u', 'file.py']; // -u for unbuffered live interactive I/O
        }

        // ── Live Interactive Run Phase ────────────────────
        isRunning = true;
        ws.send(JSON.stringify({ type: 'status', status: 'running', message: 'Running program...' }));

        proc = spawn(runCmd, runArgs, {
          cwd: sessionDir,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        sessionTimeoutTimer = setTimeout(() => {
          if (isRunning && proc) {
            ws.send(JSON.stringify({
              type: 'stderr',
              data: '\r\n\x1b[31m[Session timed out (30s limit exceeded). Process terminated.]\x1b[0m\r\n'
            }));
            try { proc.kill('SIGKILL'); } catch (_) { }
          }
        }, SESSION_TIMEOUT_MS);

        proc.stdout.on('data', chunk => {
          totalOutputBytes += chunk.length;
          if (totalOutputBytes > OUTPUT_LIMIT_BYTES) {
            ws.send(JSON.stringify({
              type: 'stderr',
              data: '\r\n\x1b[33m[Output limit (512 KB) exceeded — process terminated]\x1b[0m\r\n'
            }));
            try { proc.kill('SIGKILL'); } catch (_) { }
            return;
          }
          ws.send(JSON.stringify({ type: 'stdout', data: chunk.toString() }));
        });

        proc.stderr.on('data', chunk => {
          totalOutputBytes += chunk.length;
          if (totalOutputBytes > OUTPUT_LIMIT_BYTES) {
            ws.send(JSON.stringify({
              type: 'stderr',
              data: '\r\n\x1b[33m[Output limit (512 KB) exceeded — process terminated]\x1b[0m\r\n'
            }));
            try { proc.kill('SIGKILL'); } catch (_) { }
            return;
          }
          ws.send(JSON.stringify({ type: 'stderr', data: chunk.toString() }));
        });

        proc.on('close', (code, signal) => {
          const execTime = Date.now() - runStartTime;
          ws.send(JSON.stringify({
            type: 'exit',
            code: signal ? 1 : (code === null ? 0 : code),
            signal: signal || null,
            executionTime: execTime
          }));
          cleanup();
        });

        proc.on('error', (err) => {
          const execTime = Date.now() - runStartTime;
          ws.send(JSON.stringify({
            type: 'stderr',
            data: `\r\n[Failed to run process: ${err.message}]\r\n`
          }));
          ws.send(JSON.stringify({
            type: 'exit',
            code: -1,
            executionTime: execTime
          }));
          cleanup();
        });

      } else if (msg.type === 'stdin') {
        if (isRunning && proc && proc.stdin && proc.stdin.writable) {
          const raw = msg.data;
          const normalized = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n') : raw;
          proc.stdin.write(normalized);
        }
      } else if (msg.type === 'stop') {
        if (isRunning && proc) {
          ws.send(JSON.stringify({
            type: 'stderr',
            data: '\r\n\x1b[33m[Process stopped by user.]\x1b[0m\r\n'
          }));
          try { proc.kill('SIGKILL'); } catch (_) { }
        }
      }
    });

    ws.on('close', () => {
      cleanup();
      sessions.delete(ws);
      if (sessions.size === 0) activeSessionsByIp.delete(clientIp);
    });

    ws.on('error', () => {
      cleanup();
      sessions.delete(ws);
      if (sessions.size === 0) activeSessionsByIp.delete(clientIp);
    });
  });
}

// 404 Handler for missing pages / resources
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Resource not found' });
  }
  if (req.accepts('html')) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.status(404).type('txt').send('Resource not found');
});

// Global JSON Error Handler (must be last middleware)
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[Unhandled Internal Error]:', err.message || err);
  }
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      message: status >= 500 ? 'An unexpected internal error occurred.' : (err.message || 'An error occurred.')
    });
  }
  res.status(status).send('An unexpected error occurred.');
});

const http = require('http');
const server = http.createServer(app);
setupCompilerWebSocket(server);

if (require.main === module) {
  if (process.env.QA_MODE === 'true') {
    const { assertSafeQaEnvironment } = require('./lib/qa-guard');
    assertSafeQaEnvironment();
  }
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  server.listen(PORT, HOST, () => {
    console.log(`Semester Library server running at http://localhost:${PORT}`);
    try {
      const os = require('os');
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            console.log(`  LAN URL (for phone/Expo): http://${net.address}:${PORT}`);
          }
        }
      }
    } catch (e) {}
  });
}

app.server = server;
module.exports = app;
