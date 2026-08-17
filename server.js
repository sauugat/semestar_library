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

// --- Middleware & Session Hardening ---
app.use(express.json());

app.use(session({
  name: '__gu_session',
  secret: process.env.SESSION_SECRET || 'gu_semester_lib_sec_9938b849204018247df4382',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
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
    return res.json({ message: 'Login successful', redirect: '/dashboard.html' });
  });
});

app.get('/api/me', requireLogin, (req, res) => {
  const student = db.prepare('SELECT studentId, name FROM students WHERE studentId = ?').get(req.session.studentId);

  if (!student) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: 'Authentication required' });
  }

  res.json({ studentId: student.studentId, name: student.name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('__gu_session');
    res.json({ message: 'Logged out' });
  });
});

// --- File upload system ---

app.post('/api/files/upload', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file was uploaded.' });
  }

  const title = (req.body.title || '').trim() || null;
  const subject = (req.body.subject || '').trim() || null;
  const chapter = (req.body.chapter || '').trim() || null;

  const stmt = db.prepare(`
    INSERT INTO files (storedName, originalName, title, subject, chapter, uploadedBy, sizeBytes, uploadedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.file.filename,
    req.file.originalname,
    title,
    subject,
    chapter,
    req.session.studentId,
    req.file.size,
    new Date().toISOString()
  );

  res.json({ message: 'File uploaded successfully', fileId: result.lastInsertRowid });
});

app.get('/api/files', requireLogin, (req, res) => {
  const files = db.prepare(`
    SELECT files.id, files.originalName, files.title, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    ORDER BY files.uploadedAt DESC
  `).all(req.session.studentId);

  res.json(files);
});

app.get('/api/files/:id/download', requireLogin, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const filePath = path.join(UPLOAD_DIR, file.storedName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File missing from server' });
  }

  res.download(filePath, file.originalName);
});

// View a file in-browser (requires login) — displays it instead of downloading
app.get('/api/files/:id/view', requireLogin, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);

  if (!file) {
    return res.status(404).json({ message: 'File not found' });
  }

  const filePath = path.join(UPLOAD_DIR, file.storedName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File missing from server' });
  }

  res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
  res.sendFile(filePath);
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

// List files within a subject + chapter
app.get('/api/library/files', requireLogin, (req, res) => {
  const { subject, chapter } = req.query;

  if (!subject) {
    return res.status(400).json({ message: 'subject is required' });
  }

  let query = `
    SELECT files.id, files.originalName, files.title, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.subject = ?
  `;
  const params = [req.session.studentId, subject];

  if (chapter) {
    query += ' AND files.chapter = ?';
    params.push(chapter);
  } else {
    query += ` AND (files.chapter IS NULL OR files.chapter = '')`;
  }

  query += ' ORDER BY files.uploadedAt DESC';

  const files = db.prepare(query).all(...params);
  res.json(files);
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
    SELECT studentId, name, avatarUrl, bio, department, semester, githubUrl, linkedinUrl
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

  return {
    studentId: student.studentId,
    name: student.name,
    avatarUrl: student.avatarUrl || null,
    bio: student.bio || '',
    department: student.department || 'B.Sc. CSIT',
    semester: student.semester || 'Semester 1',
    githubUrl: student.githubUrl || '',
    linkedinUrl: student.linkedinUrl || '',
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

  if (!fs.existsSync(filePath)) {
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

  const files = db.prepare(`
    SELECT files.id, files.originalName, files.title, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, files.uploadedBy,
      students.name AS uploaderName, students.avatarUrl AS uploaderAvatar,
      (SELECT COUNT(*) FROM file_likes WHERE file_likes.fileId = files.id) AS likeCount,
      EXISTS(SELECT 1 FROM file_likes WHERE fileId = files.id AND studentId = ?) AS liked,
      (SELECT COUNT(*) FROM file_comments WHERE file_comments.fileId = files.id) AS commentCount
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    WHERE files.uploadedBy = ?
    ORDER BY files.uploadedAt DESC
  `).all(viewerStudentId, targetStudentId);

  res.json(files);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Semester Library server running at http://localhost:${PORT}`);
});