const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');

let server;
let baseUrl;
let token;

test.before(async () => {
  await db.initSchema();

  const testHash = bcrypt.hashSync('testPass123', 10);
  if (db.isPostgres) {
    await db.run(
      `INSERT INTO students (studentId, name, passwordHash, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash`,
      'stu_custom_sub_test', 'Custom Sub Student', testHash, 'student'
    );
  } else {
    await db.run(
      'INSERT OR REPLACE INTO students (studentId, name, passwordHash, role) VALUES (?, ?, ?, ?)',
      'stu_custom_sub_test', 'Custom Sub Student', testHash, 'student'
    );
  }

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Login to get token
  const loginRes = await fetch(`${baseUrl}/api/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: 'stu_custom_sub_test', password: 'testPass123' }),
  });
  assert.equal(loginRes.status, 200, 'Mobile login must succeed');
  const loginData = await loginRes.json();
  token = loginData.token;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('End-to-End: Custom Subject Upload & Library Discovery Flow', async (t) => {
  const customSubjectName = `Quantum Computing ${Date.now()}`;
  const customChapterName = 'Unit 1: Qubits and Superposition';
  const customSemester = 'Semester II';
  let uploadedFileId = null;

  try {
    // 1. Upload note with custom subject via POST /api/files/upload
    await t.test('1. Note uploads with custom subject and saves in files table', async () => {
      const fakePdfContent = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF';

      const formData = new FormData();
      const blob = new Blob([fakePdfContent], { type: 'application/pdf' });
      formData.append('files', blob, 'quantum_notes.pdf');
      formData.append('title', 'Quantum Computing Foundations');
      formData.append('semester', customSemester);
      formData.append('subject', customSubjectName);
      formData.append('chapter', customChapterName);

      const uploadRes = await fetch(`${baseUrl}/api/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      assert.equal(uploadRes.status, 200, `Upload should succeed, status: ${uploadRes.status}`);
      const uploadJson = await uploadRes.json();
      assert.ok(uploadJson.files && uploadJson.files.length > 0, 'Must return uploaded file list');
      uploadedFileId = uploadJson.files[0].id;
      assert.ok(uploadedFileId, 'Must return inserted file ID');

      // Verify directly in database files table
      const dbRecord = await db.get('SELECT * FROM files WHERE id = ?', uploadedFileId);
      assert.ok(dbRecord, 'Record must be saved in files table');
      assert.equal(dbRecord.subject, customSubjectName, 'files.subject must store custom subject');
      assert.equal(dbRecord.semester, customSemester, 'files.semester must store target semester');
      assert.equal(dbRecord.chapter, customChapterName, 'files.chapter must store custom chapter');
    });

    // 2. Verify GET /api/library/stats reflects custom subject
    await t.test('2. /api/library/stats includes the custom subject', async () => {
      const statsRes = await fetch(`${baseUrl}/api/library/stats`);
      assert.equal(statsRes.status, 200);
      const stats = await statsRes.json();
      assert.ok(Array.isArray(stats), 'Stats must return array');

      const matchingStat = stats.find(
        (s) => s.subject === customSubjectName && s.semester === customSemester
      );
      assert.ok(matchingStat, 'Library stats must include the new custom subject under target semester');
      assert.equal(matchingStat.chapter, customChapterName);
      assert.ok(Number(matchingStat.fileCount || matchingStat.filecount) >= 1);
    });

    // 3. Verify GET /api/library/files can query the custom subject
    await t.test('3. /api/library/files returns the uploaded note for custom subject', async () => {
      const filesRes = await fetch(
        `${baseUrl}/api/library/files?semester=${encodeURIComponent(customSemester)}&subject=${encodeURIComponent(customSubjectName)}`
      );
      assert.equal(filesRes.status, 200);
      const files = await filesRes.json();
      assert.ok(Array.isArray(files));
      assert.ok(files.some((f) => f.id === uploadedFileId && f.subject === customSubjectName));
    });

    // 4. Verify curriculum merge logic matches mobile/app/(tabs)/library.tsx
    await t.test('4. Curriculum merge logic integrates custom subject into Semester II subjects', async () => {
      const statsRes = await fetch(`${baseUrl}/api/library/stats`);
      const stats = await statsRes.json();

      // Static curriculum simulator matching mobile/constants/subjects.config.ts
      const currentSemester = {
        id: 'Semester II',
        semester: 'II',
        label: 'Semester II',
        shortLabel: 'Semester 2',
        subjects: [
          { code: 'MATH201', title: 'Mathematics II', chapters: [] },
        ],
      };

      function isMatchingSemester(dbSemester, semItem) {
        if (!dbSemester) return false;
        const clean = dbSemester.trim().toLowerCase();
        return (
          clean === semItem.id.toLowerCase() ||
          clean === semItem.semester.toLowerCase() ||
          clean === semItem.label.toLowerCase() ||
          clean === semItem.shortLabel.toLowerCase() ||
          clean === `semester ${semItem.semester.toLowerCase()}`
        );
      }

      const baseSubjects = currentSemester.subjects;
      const subjectMap = new Map();
      baseSubjects.forEach((sub) => {
        subjectMap.set(sub.title.toLowerCase().trim(), { ...sub, chapters: [...sub.chapters] });
      });

      stats.forEach((stat) => {
        if (!stat.subject || !stat.subject.trim()) return;
        if (!isMatchingSemester(stat.semester, currentSemester)) return;

        const key = stat.subject.toLowerCase().trim();
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            code: 'CUSTOM',
            title: stat.subject.trim(),
            credit: '—',
            chapters: [{ id: 'ALL', title: 'All Notes / Files', isSpecial: true }],
          });
        }

        if (stat.chapter && stat.chapter.trim()) {
          const sub = subjectMap.get(key);
          const chapTitle = stat.chapter.trim();
          if (!sub.chapters.some((c) => c.title.toLowerCase() === chapTitle.toLowerCase())) {
            sub.chapters.push({ id: chapTitle, title: chapTitle, shortTitle: chapTitle });
          }
        }
      });

      const mergedSubjects = Array.from(subjectMap.values());
      const customSubInList = mergedSubjects.find((s) => s.title === customSubjectName);
      assert.ok(customSubInList, 'Custom subject must appear in merged subjects list in Library');
      assert.equal(customSubInList.code, 'CUSTOM');
      assert.ok(
        customSubInList.chapters.some((c) => c.title === customChapterName),
        'Custom chapter must be listed under custom subject'
      );
    });

  } finally {
    // 5. Clean up test note
    if (uploadedFileId) {
      const f = await db.get('SELECT storedName FROM files WHERE id = ?', uploadedFileId);
      if (f && f.storedName) {
        const filePath = path.join(__dirname, '../uploads', path.basename(f.storedName));
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }
      await db.run('DELETE FROM files WHERE id = ?', uploadedFileId);
      await db.run('DELETE FROM note_search_documents WHERE fileId = ?', uploadedFileId).catch(() => {});
    }
  }
});
