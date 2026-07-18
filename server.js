const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'database.db'));

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'semester-library-secret-key', // change this in production
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 6 } // 6 hours
}));

// --- Ensure students table exists ---
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    studentId TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    passwordHash TEXT NOT NULL
  )
`);

// --- Routes ---

// Login
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

// Get current logged-in student
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

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Semester Library server running at http://localhost:${PORT}`);
});
