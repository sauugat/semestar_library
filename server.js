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

// If upgrading from an older database that doesn't have the title column yet
try {
  db.exec(`ALTER TABLE files ADD COLUMN title TEXT`);
} catch (e) {
  // Column already exists — safe to ignore
}

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

  const stmt = db.prepare(`
    INSERT INTO files (storedName, originalName, title, uploadedBy, sizeBytes, uploadedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.file.filename,
    req.file.originalname,
    title,
    req.session.studentId,
    req.file.size,
    new Date().toISOString()
  );

  res.json({ message: 'File uploaded successfully', fileId: result.lastInsertRowid });
});

app.get('/api/files', requireLogin, (req, res) => {
  const files = db.prepare(`
    SELECT files.id, files.originalName, files.title, files.sizeBytes, files.uploadedAt, students.name AS uploaderName
    FROM files
    JOIN students ON students.studentId = files.uploadedBy
    ORDER BY files.uploadedAt DESC
  `).all();

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Semester Library server running at http://localhost:${PORT}`);
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