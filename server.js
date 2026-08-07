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

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'semester-library-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 6 }
}));

function requireLogin(req, res, next) {
  if (!req.session.studentId) {
    return res.status(401).json({ message: 'Not logged in' });
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

// --- Routes ---

app.post('/api/login', (req, res) => {
  const { studentId, password } = req.body;

  if (!studentId || !password) {
    return res.status(400).json({ message: 'Student ID and password are required.' });
  }

  const student = db.prepare('SELECT * FROM students WHERE studentId = ?').get(studentId);

  if (!student) {
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  const match = bcrypt.compareSync(password, student.passwordHash);

  if (!match) {
    return res.status(401).json({ message: 'Invalid Student ID or Password' });
  }

  req.session.studentId = student.studentId;
  return res.json({ message: 'Login successful' });
});

app.get('/api/me', (req, res) => {
  if (!req.session.studentId) {
    return res.status(401).json({ message: 'Not logged in' });
  }

  const student = db.prepare('SELECT studentId, name FROM students WHERE studentId = ?').get(req.session.studentId);

  if (!student) {
    return res.status(401).json({ message: 'Not logged in' });
  }

  res.json({ studentId: student.studentId, name: student.name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
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
    SELECT files.id, files.originalName, files.title, files.sizeBytes, files.uploadedAt, students.name AS uploaderName,
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
    SELECT files.id, files.originalName, files.title, files.subject, files.chapter, files.sizeBytes, files.uploadedAt, students.name AS uploaderName,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Semester Library server running at http://localhost:${PORT}`);
});