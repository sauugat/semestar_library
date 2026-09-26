const express = require('express');

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

async function indexUploadedNote(file) {
  try {
    const status = await noteSearch.indexNote(db, file);
    require('./ai-assistant').invalidateCache(db);
    return status;
  } catch (err) {
    console.error('[Note indexing failed]', file.id, err.code || err.name);
    return { status: 'failed' };
  }
}

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
let broadcastChannel = null;

if (process.env.NODE_ENV !== 'test' && supabaseUrl && supabaseKey) {
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
  } catch (e) { }
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
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB per file
});

const chatUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
  fileFilter: (req, file, cb) => {
    const m = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.txt', '.c', '.cpp', '.py', '.java', '.js', '.html', '.css', '.json'];
    if (m.startsWith('image/') || m.startsWith('video/') || m.startsWith('application/pdf') || m.startsWith('text/') || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File format not supported. Please upload an image, video, PDF, document, or code file.'));
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

// Ensure schema is fully initialized before serving requests
let isDbReady = false;
let initDbPromise = null;
app.use(async (req, res, next) => {
  if (!isDbReady) {
    if (!initDbPromise) {
      initDbPromise = db.initSchema().then(() => {
        isDbReady = true;
      });
    }
    try {
      await initDbPromise;
    } catch (err) {
      return res.status(503).json({ message: 'Database initialization in progress. Please retry.' });
    }
  }
  next();
});

// Mobile Bearer Token Authentication Middleware
// Allows mobile apps (React Native / Expo) to authenticate using Authorization: Bearer <token>
// Runs alongside session cookies; does not interfere with browser sessions
app.use(async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        const tokenRecord = await db.get(
          'SELECT token, studentId, expiresAt FROM mobile_tokens WHERE token = ?',
          token
        );
        if (tokenRecord) {
          const rawExpiry = tokenRecord.expiresAt || tokenRecord.expiresat;
          const expiresAt = new Date(rawExpiry).getTime();
          if (expiresAt > Date.now()) {
            const sid = tokenRecord.studentId || tokenRecord.studentid;
            const student = await db.get(
              'SELECT studentId, name, role FROM students WHERE studentId = ?',
              sid
            );
            if (student) {
              if (!req.session) req.session = {};
              req.session.studentId = student.studentId;
              req.session.studentName = student.name;
              req.session.role = student.role || 'student';
              req.user = student;
              req.mobileToken = token;
            }
          } else {
            // Delete expired token asynchronously
            db.run('DELETE FROM mobile_tokens WHERE token = ?', token).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[Mobile Auth Middleware Error]:', err.message);
      }
    }
  }
  next();
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

// Assignments / Code Lab — show subjects directly
app.get(['/assignments', '/code-lab', '/code-lab/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'code-lab', 'subjects.html'));
});

app.get('/code-lab/compiler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'code-lab', 'index.html'));
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

app.get('/compiler', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'compiler.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get(['/terms', '/termsandconditions'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'termsandconditions.html'));
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

// Serve static assets securely
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Check the resolved path so encoded URLs cannot bypass protection for uploaded SVGs.
    const postUploads = path.join(__dirname, 'public', 'uploads', 'posts') + path.sep;
    if (filePath.startsWith(postUploads)) {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    }
  }
}));

function requireLogin(req, res, next) {
  (async () => {
    if (!req.session || !req.session.studentId) {
      return res.status(401).json({ message: 'Authentication required. Please sign in.' });
    }
    if (req.session.studentId === 'guest') {
      return next();
    }
    try {
      const student = await db.get('SELECT studentId, role FROM students WHERE studentId = ?', req.session.studentId);
      if (!student) {
        if (typeof req.session.destroy === 'function') req.session.destroy(() => {});
        if (res.clearCookie) res.clearCookie('__gu_session');
        return res.status(401).json({ message: 'Authentication required. Account not found.' });
      }
      req.session.role = student.role || 'student';
      next();
    } catch (err) {
      next(err);
    }
  })();
}
app.use('/api/posts', require('./routes/posts')(db, requireLogin));

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
      return res.json({ message: 'Login successful', redirect: '/dashboard.html' });
    });
  });
});

app.post('/api/mobile/login', loginRateLimiter, async (req, res) => {
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

  const match = bcrypt.compareSync(password, student.passwordHash);

  if (!match) {
    await recordFailedLogin(ip);
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
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

  return res.json({
    token,
    user: {
      studentId: student.studentId,
      name: student.name,
      role: student.role || 'student'
    }
  });
});

app.get('/api/me', requireLogin, async (req, res) => {
  if (req.session.studentId === 'guest') {
    return res.json({ studentId: 'guest', name: 'Guest User', role: 'student', isAdmin: false });
  }

  const student = await db.get('SELECT studentId, name, role FROM students WHERE studentId = ?', req.session.studentId);

  if (!student) {
    req.session.destroy(() => { });
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

  // Revoke other active sessions for this student upon password change
  const currentSid = req.sessionID;
  try {
    if (db.isPostgres) {
      await db.run(
        `DELETE FROM session WHERE sid != $1 AND (sess->>'studentId' = $2 OR sess::text LIKE '%' || $2 || '%')`,
        currentSid, req.session.studentId
      );
    } else {
      await db.run(
        `DELETE FROM session WHERE sid != ? AND sess LIKE ?`,
        currentSid, `%"studentId":"${req.session.studentId}"%`
      );
    }
  } catch (sessErr) {
    console.warn('[Session Revocation Warning]:', sessErr.message);
  }

  res.json({ message: 'Password successfully updated' });
});

app.post('/api/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('__gu_session');
    return res.json({ message: 'Logged out' });
  }
  req.session.destroy((err) => {
    res.clearCookie('__gu_session');
    if (err) {
      console.error('[Logout Error]:', err.message);
      return res.status(500).json({ message: 'Logout failed. Please clear your cookies.' });
    }
    res.json({ message: 'Logged out' });
  });
});

app.post('/api/mobile/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        await db.run('DELETE FROM mobile_tokens WHERE token = ?', token);
      } catch (err) {
        console.error('[Mobile Logout Error]:', err.message);
      }
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

    // Save main file to persistent blob storage - must not report success if saving persistent file/blob failed
    try {
      if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath);
        await db.saveFileBlob(f.filename, fileBuffer, f.mimetype || 'application/octet-stream');
      }
    } catch (err) {
      console.error(`[Blob Save Failed for ${f.originalname}]:`, err.message);
      for (const up of uploadedFiles) {
        const p = path.join(UPLOAD_DIR, up.filename);
        if (isSafeUploadPath(p) && fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (_) {}
        }
        await db.deleteFileBlob(up.filename).catch(() => {});
      }
      return res.status(500).json({ message: 'Failed to persist uploaded file to storage.' });
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
      const indexing = await indexUploadedNote({ id: insertedId, storedName: f.filename, originalName: f.originalname, title: fileTitle, semester, subject, chapter, sizeBytes: f.size });
      results.push({
        id: insertedId,
        indexing,
        storedName: f.filename,
        originalName: f.originalname,
        title: fileTitle,
        previewName: previewFilename
      });

      if (insertedId) {
        // If Saugat Subedi (26020266) uploads, automatically add random natural likes from student accounts (17-44 likes)
        try {
          if (req.session.studentId === '26020266') {
            const targetLikes = Math.floor(Math.random() * (44 - 17 + 1)) + 17;
            if (db.isPostgres) {
              await db.run(`
                INSERT INTO file_likes (fileId, studentId)
                SELECT ?, studentId FROM (
                  SELECT studentId FROM students ORDER BY RANDOM() LIMIT ${targetLikes}
                ) rand_students
                ON CONFLICT (fileId, studentId) DO NOTHING RETURNING fileId
              `, insertedId);
            } else {
              await db.run(`
                INSERT OR IGNORE INTO file_likes (fileId, studentId)
                SELECT ?, studentId FROM (
                  SELECT studentId FROM students ORDER BY RANDOM() LIMIT ${targetLikes}
                )
              `, insertedId);
            }
          }
        } catch (likeErr) {
          console.warn('[Like insert warning]:', likeErr.message);
        }

        try {
          if (isAdmin) {
            await db.run(`
              INSERT INTO notifications (recipientStudentId, type, relatedFileId, message)
              SELECT studentId, 'notice', ?, ? FROM students WHERE studentId != ?
            `, insertedId, `New Official Notice: ${fileTitle || f.originalname}`, req.session.studentId);
          }
        } catch (notifErr) {
          console.warn('[Notification insert warning]:', notifErr.message);
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
  const { filename, size, mimeType } = req.body || {};
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
  const { files: uploadedFiles, title, semester, subject, chapter } = req.body;
  if (!uploadedFiles || !Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    return res.status(400).json({ message: 'No file information provided.' });
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

  const cleanSemester = (semester || '').trim() || null;
  const cleanSubject = (subject || '').trim() || null;
  const cleanChapter = (chapter || '').trim() || null;
  const cleanTitle = (title || '').trim() || null;

  const isAdmin = await isStudentAdmin(req.session.studentId);
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
        INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt, previewName)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, storedName, originalName, fileTitle, cleanSemester, cleanSubject, cleanChapter, req.session.studentId, sizeBytes, new Date().toISOString(), null);

      const insertedId = result.lastInsertRowid;
      const indexing = await indexUploadedNote({ id: insertedId, storedName, originalName, title: fileTitle, semester: cleanSemester, subject: cleanSubject, chapter: cleanChapter, sizeBytes });
      results.push({
        id: insertedId,
        indexing,
        storedName,
        originalName,
        title: fileTitle
      });

      if (insertedId) {
        // Auto-likes if applicable
        try {
          if (req.session.studentId === '26020266') {
            const targetLikes = Math.floor(Math.random() * (44 - 17 + 1)) + 17;
            if (db.isPostgres) {
              await db.run(`
                INSERT INTO file_likes (fileId, studentId)
                SELECT ?, studentId FROM (
                  SELECT studentId FROM students ORDER BY RANDOM() LIMIT ${targetLikes}
                ) rand_students
                ON CONFLICT (fileId, studentId) DO NOTHING RETURNING fileId
              `, insertedId);
            } else {
              await db.run(`
                INSERT OR IGNORE INTO file_likes (fileId, studentId)
                SELECT ?, studentId FROM (
                  SELECT studentId FROM students ORDER BY RANDOM() LIMIT ${targetLikes}
                )
              `, insertedId);
            }
          }
        } catch (likeErr) {
          console.warn('[Like insert warning]:', likeErr.message);
        }

        // Send notification for official uploads
        try {
          if (isAdmin) {
            await db.run(`
              INSERT INTO notifications (recipientStudentId, type, relatedFileId, message)
              SELECT studentId, 'notice', ?, ? FROM students WHERE studentId != ?
            `, insertedId, `New Study Material: ${fileTitle}`, req.session.studentId);
          }
        } catch (notifErr) {
          console.warn('[Notification insert warning]:', notifErr.message);
        }
      }
    }
  } catch (err) {
    console.error('Record upload DB insert error:', err);
    return res.status(500).json({ message: 'Failed to save file metadata.' });
  }

  res.json({
    message: `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} saved successfully`,
    fileId: results[0]?.id,
    files: results,
    count: uploadedFiles.length,
    isOfficial: isAdmin
  });
});

app.get('/api/files', requireLogin, async (req, res) => {
  const viewerIsAdmin = await isStudentAdmin(req.session.studentId);
  const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200) : null;
  const offset = req.query.offset ? Math.max(parseInt(req.query.offset, 10) || 0, 0) : 0;

  let query = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    ORDER BY files.uploadedAt DESC
  `;

  let files;
  if (limit !== null) {
    query += ` LIMIT ${limit} OFFSET ${offset}`;
    files = await db.all(query, req.session.studentId);
  } else {
    files = await db.all(query, req.session.studentId);
  }

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
  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!file) return res.status(404).json({ message: 'File/post not found' });

  if (!isAdmin && file.uploadedBy !== studentId) {
    return res.status(403).json({ message: 'Forbidden: You can only delete your own posts.' });
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
  require('./ai-assistant').invalidateCache(db);

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

app.get(['/api/files/:id/download', '/api/files/download/:id'], requireLogin, async (req, res) => {
  const fileId = req.params.id;
  const file = await db.get('SELECT * FROM files WHERE id = ?', fileId);

  if (!file) {
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
      // Create notification
      const file = await db.get('SELECT uploadedBy, originalName FROM files WHERE id = ?', fileId);
      if (file && file.uploadedBy !== studentId) {
        await db.run('INSERT INTO notifications (recipientStudentId, type, relatedFileId, message) VALUES (?, ?, ?, ?)',
          file.uploadedBy, 'like', fileId, `${req.session.studentName || 'Someone'} liked your file: ${file.originalName}`
        );
      }
    }
  } else {
    if (existing) {
      await db.run('DELETE FROM file_likes WHERE fileId = ? AND studentId = ?', fileId, studentId);
    }
  }

  const countRow = await db.get('SELECT COUNT(*) AS c FROM file_likes WHERE fileId = ?', fileId);
  const count = Number(countRow?.c || countRow?.count || 0);
  res.json({ liked: shouldLike, likeCount: count });
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
app.use('/api/routine', require('./routes/routine')(db, requireLogin, {
  invalidateCache: () => require('./ai-assistant').invalidateCache(db)
}));

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
  const viewerIsAdmin = currentStudentId ? await isStudentAdmin(currentStudentId) : false;

  // Search files (title, originalName, subject, chapter, uploadedBy studentId, uploader name)
  const filesQuery = `
    SELECT files.id, files.originalName, files.title, files.semester, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar, students.role AS uploaderRole,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE LOWER(files.title) LIKE LOWER(?) OR LOWER(files.originalName) LIKE LOWER(?) OR LOWER(files.subject) LIKE LOWER(?) OR LOWER(files.chapter) LIKE LOWER(?) OR LOWER(files.semester) LIKE LOWER(?) OR LOWER(files.uploadedBy) LIKE LOWER(?) OR LOWER(students.name) LIKE LOWER(?)
    ORDER BY files.uploadedAt DESC
    LIMIT 50
  `;
  const files = await db.all(filesQuery, currentStudentId || '', likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery);

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
    WHERE subject IS NOT NULL AND subject != '' AND LOWER(subject) LIKE LOWER(?)
    GROUP BY subject
    ORDER BY subject ASC
    LIMIT 20
  `;
  const subjects = await db.all(subjectsQuery, likeQuery);

  // Search students (by studentId, name, department)
  const studentsQuery = `
    SELECT studentId, name, avatarUrl, role, department, semester, bio,
      (SELECT COUNT(*) FROM files WHERE files.uploadedBy = students.studentId) AS filesCount
    FROM students
    WHERE LOWER(studentId) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?)
    ORDER BY (role = 'admin') DESC, (role = 'cr') DESC, name ASC
    LIMIT 10
  `;
  const students = await db.all(studentsQuery, cleanLikeQuery, cleanLikeQuery);

  // Search assignments (by title, subject, semester, createdBy, teacher name)
  let assignments = [];
  try {
    const assignmentsQuery = `
      SELECT a.*, s.name AS teacherName,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount,
        (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissionCount,
        ${currentStudentId ? `(SELECT COUNT(DISTINCT COALESCE(sub.questionId, sub.id)) FROM submissions sub WHERE sub.assignmentId = a.id AND sub.studentId = '${currentStudentId}')` : '0'} AS mySubmissionCount
      FROM assignments a
      JOIN students s ON s.studentId = a.createdBy
      WHERE LOWER(a.title) LIKE LOWER(?) OR LOWER(a.subject) LIKE LOWER(?) OR LOWER(a.semester) LIKE LOWER(?) OR LOWER(a.createdBy) LIKE LOWER(?) OR LOWER(s.name) LIKE LOWER(?)
      ORDER BY a.createdAt DESC
      LIMIT 15
    `;
    assignments = await db.all(assignmentsQuery, likeQuery, likeQuery, likeQuery, cleanLikeQuery, cleanLikeQuery);
  } catch (err) {
    console.error('Assignment search error:', err);
  }

  res.json({ files: processedFiles, subjects, students, assignments });
});

// ============================================================
// GROUP CHAT SYSTEM
// ============================================================

app.get('/api/chat/config', requireLogin, (req, res) => {
  res.json({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY });
});

app.get('/api/chat/messages', requireLogin, async (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const before = parseInt(req.query.before) || 0;
  const limit = Math.min(parseInt(req.query.limit) || (before ? 35 : 200), 200);

  let messages;
  if (before > 0) {
    messages = await db.all(`
      SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
        students.studentId, students.name, students.avatarUrl,
        reply_msg.text AS replyText, reply_student.name AS replySender
      FROM chat_messages
      LEFT JOIN students ON students.studentId = chat_messages.studentId
      LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
      LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
      WHERE chat_messages.id < ?
      ORDER BY chat_messages.id DESC
      LIMIT ?
    `, before, limit);
    messages.reverse(); // restore chronological order
  } else {
    messages = await db.all(`
      SELECT chat_messages.id, chat_messages.text, chat_messages.attachmentName, chat_messages.attachmentOriginalName, chat_messages.attachmentMimeType, chat_messages.replyToId, chat_messages.createdAt,
        students.studentId, students.name, students.avatarUrl,
        reply_msg.text AS replyText, reply_student.name AS replySender
      FROM chat_messages
      LEFT JOIN students ON students.studentId = chat_messages.studentId
      LEFT JOIN chat_messages AS reply_msg ON reply_msg.id = chat_messages.replyToId
      LEFT JOIN students AS reply_student ON reply_student.studentId = reply_msg.studentId
      WHERE chat_messages.id > ?
      ORDER BY chat_messages.id ASC
      LIMIT ?
    `, since, limit);
  }

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

  res.json({ messages, readReceipts });
});

// Class Group Members endpoint
app.get('/api/chat/members', requireLogin, async (req, res) => {
  try {
    const members = await db.all(`
      SELECT s.studentId, s.name, s.avatarUrl, s.semester, s.department, s.role,
        r.lastReadMessageId,
        (SELECT MAX(createdAt) FROM chat_messages WHERE studentId = s.studentId) AS lastMessageAt
      FROM students s
      LEFT JOIN chat_read_receipts r ON r.studentId = s.studentId
      ORDER BY s.name ASC
    `);
    res.json({ total: members.length, members });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch members' });
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
    const role = req.session.role;
    const isAdmin = await isStudentAdmin(req.session.studentId);
    if (!isAdmin && role !== 'admin' && role !== 'cr') {
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

    sendBroadcast('pin_message', pinnedMessage);
    res.json({ success: true, pinned: pinnedMessage });
  } catch (err) {
    console.error('[Pin Chat Error]:', err.message);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

app.delete('/api/chat/pinned', requireLogin, async (req, res) => {
  try {
    const role = req.session.role;
    const isAdmin = await isStudentAdmin(req.session.studentId);
    if (!isAdmin && role !== 'admin' && role !== 'cr') {
      return res.status(403).json({ error: 'Forbidden: Only admins or class representatives can unpin messages.' });
    }

    await db.run('DELETE FROM chat_pinned WHERE id = 1');
    sendBroadcast('pin_message', { unpinned: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

app.post('/api/chat/reactions', requireLogin, async (req, res) => {
  const { messageId, emoji } = req.body;
  const studentId = req.session.studentId;
  if (!messageId || !emoji) return res.status(400).json({ error: 'Missing data' });

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

    sendBroadcast('reaction_update', { messageId, studentId, emoji, action });

    res.json({ success: true, action });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

app.post('/api/chat/read', requireLogin, async (req, res) => {
  const lastReadMessageId = parseInt(req.body.lastReadMessageId, 10);
  const studentId = req.session.studentId;
  if (!lastReadMessageId || isNaN(lastReadMessageId)) return res.status(400).json({ error: 'Missing or invalid lastReadMessageId' });

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

    // Clean up physical attachment file and persistent blob
    if (msg.attachmentName) {
      const attFilename = path.basename(msg.attachmentName);
      const attPath = path.join(UPLOAD_DIR, attFilename);
      if (isSafeUploadPath(attPath) && fs.existsSync(attPath)) {
        try { fs.unlinkSync(attPath); } catch (_) {}
      }
      await db.deleteFileBlob(attFilename).catch(() => {});
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
  if (!/^[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  // Ensure this file actually belongs to a chat message attachment
  const msg = await db.get('SELECT id FROM chat_messages WHERE attachmentName = ? LIMIT 1', filename);
  if (!msg) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  const filePath = await ensureLocalFile(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found on server' });
  }

  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
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
  const studentId = req.session.studentId;

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
  const updatedSem = (semester && semester.trim()) ? semester.trim().slice(0, 30) : (current.semester || 'Semester 1');
  const updatedGithub = typeof githubUrl === 'string' ? githubUrl.trim().slice(0, 150) : (current.githubUrl || '');
  const updatedLinkedin = typeof linkedinUrl === 'string' ? linkedinUrl.trim().slice(0, 150) : (current.linkedinUrl || '');

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

  // Clean up previous avatar file and blob if replacing an existing custom avatar
  try {
    const current = await db.get('SELECT avatarUrl FROM students WHERE studentId = ?', studentId);
    if (current && current.avatarUrl && current.avatarUrl.startsWith('/api/avatar/')) {
      const oldFilename = path.basename(current.avatarUrl);
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

  await db.run('UPDATE students SET avatarUrl = ? WHERE studentId = ?', avatarUrl, studentId);

  res.json({ message: 'Profile picture updated successfully', avatarUrl });
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

// Toggle/set follow/unfollow a student (retry-safe)
app.post('/api/profile/:studentId/follow', requireLogin, async (req, res) => {
  const followerId = req.session.studentId;
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

app.post('/api/ai/chat', aiRateLimiter, require('./lib/chat-http').createChatHandler(db, aiAssistant));

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
