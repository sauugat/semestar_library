const express = require('express');
const router = express.Router();
const db = require('../../db');
const syllabusData = require('../../syllabus-data.json');

function requireLogin(req, res, next) {
    if (!req.session || !req.session.studentId) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    next();
}

async function isAdmin(studentId) {
    const s = await db.get('SELECT role FROM students WHERE studentId = ?', studentId);
    return s && s.role === 'admin';
}

const COMPILER_URL = process.env.COMPILER_URL || 'https://slcompiler.duckdns.org/api/compile';
const INTERNAL_COMPILER_KEY = process.env.INTERNAL_COMPILER_KEY || 'codelab-internal-vm-secret-key-2026';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
}

const pdfStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = 'assignment-pdf-' + crypto.randomBytes(12).toString('hex') + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const uploadAssignmentPdf = multer({
    storage: pdfStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF documents are allowed.'));
        }
    }
});

// ── POST /upload-assignment-pdf — upload assignment PDF document ─────────────
router.post('/upload-assignment-pdf', requireLogin, async (req, res) => {
    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only teachers/admins can upload assignment PDFs.' });
    }

    uploadAssignmentPdf.single('pdf')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ message: err.message || 'File upload error.' });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'No PDF file uploaded.' });
        }

        try {
            const filePath = req.file.path;
            const buffer = fs.readFileSync(filePath);
            // Validate PDF magic bytes: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
            if (buffer.length < 5 || buffer.toString('utf8', 0, 5) !== '%PDF-') {
                try { fs.unlinkSync(filePath); } catch (_) {}
                return res.status(400).json({ message: 'Uploaded file is not a valid PDF document.' });
            }

            const saved = await db.saveFileBlob(req.file.filename, buffer, 'application/pdf');
            if (!saved) {
                try { fs.unlinkSync(filePath); } catch (_) {}
                return res.status(500).json({ message: 'Failed to save uploaded PDF.' });
            }

            return res.json({
                success: true,
                pdfUrl: `/api/code-lab/pdf/${req.file.filename}`,
                pdfName: req.file.originalname,
                filename: req.file.filename
            });
        } catch (saveErr) {
            try { if (req.file) fs.unlinkSync(req.file.path); } catch (_) {}
            console.error('[Code Lab] PDF Blob Save Error:', saveErr);
            return res.status(500).json({ message: 'Failed to save uploaded PDF.' });
        }
    });
});

// ── GET /pdf/:filename — stream assignment PDF inline for viewer ────────────
router.get('/pdf/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename);

    // Verify this filename is actually referenced by an assignment
    const assignment = await db.get('SELECT id FROM assignments WHERE pdfUrl LIKE ? OR pdfName = ?', `%${filename}`, filename);
    const adminCheck = req.session && req.session.studentId ? await isAdmin(req.session.studentId) : false;
    if (!assignment && !adminCheck) {
        return res.status(404).json({ message: 'Assignment PDF not found.' });
    }

    const localPath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(localPath)) {
        try {
            const blob = await db.getFileBlob(filename);
            if (blob && blob.fileData) {
                if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
                fs.writeFileSync(localPath, blob.fileData);
            }
        } catch (e) {
            console.warn('[Code Lab] Error restoring PDF blob:', e.message);
        }
    }

    if (!fs.existsSync(localPath)) {
        return res.status(404).json({ message: 'Assignment PDF not found.' });
    }

    // Double-check file magic bytes before serving
    try {
        const header = Buffer.alloc(5);
        const fd = fs.openSync(localPath, 'r');
        fs.readSync(fd, header, 0, 5, 0);
        fs.closeSync(fd);
        if (header.toString('utf8', 0, 5) !== '%PDF-') {
            return res.status(403).json({ message: 'File is not a valid PDF.' });
        }
    } catch (_) {}

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.sendFile(localPath);
});

async function runTestCases(language, code, testCases) {
    if (!Array.isArray(testCases) || testCases.length === 0) return null;
    const results = [];
    for (const tc of testCases) {
        try {
            const response = await fetch(COMPILER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-codelab-internal-token': INTERNAL_COMPILER_KEY
                },
                body: JSON.stringify({
                    language: language || 'c',
                    code,
                    input: tc.input || ''
                })
            });
            const data = await response.json();
            const actual = (data.stdout || '').trimEnd();
            const expected = (tc.expectedOutput || '').trimEnd();
            const passed = data.success !== false && actual === expected;
            results.push({
                input: tc.input || '',
                expected: tc.expectedOutput || '',
                actual: (data.stdout || (data.stderr ? `Error: ${data.stderr.trim()}` : (data.error || ''))).trimEnd(),
                passed
            });
        } catch (err) {
            console.error(`[Code Lab] Error running test case for language=${language}:`, err.message);
            results.push({
                input: tc.input || '',
                expected: tc.expectedOutput || '',
                actual: `Execution error: ${err.message}`,
                passed: false
            });
        }
    }
    return results;
}

// ── GET /subjects — return semester/subject list from syllabus-data.json ────
router.get('/subjects', (req, res) => {
    const semesters = (syllabusData.semesters || []).map(s => ({
        semester: s.semester,
        year: s.year,
        courses: (s.courses || []).map(c => ({
            title: c.title,
            code: c.code,
            credit: c.credit,
            nature: c.nature
        }))
    }));
    res.json({ semesters });
});

// ── POST /assignments — admin only, accepts nested questions ────────────────
router.post('/assignments', requireLogin, async (req, res) => {
    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can create assignments.' });
    }

    const { title, subject, semester, deadline, questions } = req.body;
    const pdfUrl = req.body.pdfUrl || req.body.pdfurl || null;
    const pdfName = req.body.pdfName || req.body.pdfname || null;
    const language = (req.body.language && typeof req.body.language === 'string') ? req.body.language.trim().toLowerCase() : 'c';

    if (!title) {
        return res.status(400).json({ message: 'Assignment title is required.' });
    }

    let finalQuestions = Array.isArray(questions) && questions.length > 0 ? questions : [];
    // If an assignment PDF is attached and no manual questions are supplied, provide an initial flexible Question 1 with the chosen language
    if (finalQuestions.length === 0 && pdfUrl) {
        finalQuestions = [{
            title: 'Question 1',
            description: 'Refer to attached assignment PDF for problem statement',
            language: language || 'c',
            maxPoints: 10
        }];
    }

    if (finalQuestions.length === 0) {
        return res.status(400).json({ message: 'At least one question or an assignment PDF is required.' });
    }

    // Validate each question: Title is compulsory, Problem Statement / Description is optional
    for (let i = 0; i < finalQuestions.length; i++) {
        const q = finalQuestions[i];
        if (!q.title || !q.title.trim()) {
            return res.status(400).json({ message: `Question ${i + 1}: Question title is compulsory.` });
        }
    }

    const now = new Date().toISOString();
    const effectiveLanguage = finalQuestions[0].language || language || 'c';

    // Atomically create assignment, questions and test cases in a database transaction
    try {
        const { assignmentId, questionIds } = await db.withTransaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO assignments (title, description, language, subject, semester, deadline, pdfUrl, pdfName, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                title,
                finalQuestions[0].description ? finalQuestions[0].description.trim() : '',
                effectiveLanguage,
                subject || null,
                semester || null,
                deadline || null,
                pdfUrl || null,
                pdfName || null,
                req.session.studentId,
                now
            );

            const aId = result.lastInsertRowid;
            const qIds = [];

            // Create question rows
            for (let i = 0; i < finalQuestions.length; i++) {
                const q = finalQuestions[i];
                const maxPts = (q.maxPoints !== undefined && q.maxPoints !== null && !isNaN(Number(q.maxPoints)) && Number(q.maxPoints) > 0)
                    ? Math.floor(Number(q.maxPoints))
                    : 10;
                const qResult = await tx.run(
                    'INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, maxPoints, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    aId,
                    i + 1,
                    q.title.trim(),
                    q.description ? q.description.trim() : '',
                    q.language || language || 'c',
                    maxPts,
                    now
                );
                const qId = qResult.lastInsertRowid;
                qIds.push(qId);

                // Save optional test cases passed during creation
                if (Array.isArray(q.testCases) && q.testCases.length > 0) {
                    for (const tc of q.testCases) {
                        if (tc && tc.expectedOutput != null && String(tc.expectedOutput).trim().length > 0) {
                            await tx.run(
                                'INSERT INTO question_test_cases (questionId, input, expectedOutput, createdAt) VALUES (?, ?, ?, ?)',
                                qId,
                                tc.input != null ? String(tc.input) : '',
                                String(tc.expectedOutput).trim(),
                                now
                            );
                        }
                    }
                }
            }
            return { assignmentId: aId, questionIds: qIds };
        });

        res.json({ message: 'Assignment created', id: assignmentId, questionIds });
    } catch (err) {
        console.error('[Code Lab] Assignment creation transaction error:', err);
        res.status(500).json({ message: 'Failed to create assignment.' });
    }
});

// ── GET /assignments — list with optional subject/semester filtering ─────────
router.get('/assignments', async (req, res) => {
    const { subject, semester } = req.query;
    const currentStudentId = req.session && req.session.studentId ? req.session.studentId : null;
    let sql, params = [];

    const ROMAN_MAP = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII' };
    const NUM_MAP = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4', 'V': '5', 'VI': '6', 'VII': '7', 'VIII': '8' };

    const mySubSql = currentStudentId
        ? `(SELECT COUNT(DISTINCT COALESCE(sub.questionId, sub.id)) FROM submissions sub WHERE sub.assignmentId = a.id AND sub.studentId = ?) AS mySubmissionCount`
        : `0 AS mySubmissionCount`;

    const selectFields = `
        a.*, s.name AS teacherName,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount,
        (SELECT COUNT(DISTINCT studentId) FROM submissions sub WHERE sub.assignmentId = a.id) AS submissionCount,
        ${mySubSql}
    `;

    if (subject && semester) {
        const semAlt = ROMAN_MAP[String(semester)] || NUM_MAP[String(semester)] || semester;
        sql = `
            SELECT ${selectFields}
            FROM assignments a
            JOIN students s ON s.studentId = a.createdBy
            WHERE a.subject = ? AND (a.semester = ? OR a.semester = ?)
            ORDER BY a.createdAt DESC`;
        params = currentStudentId ? [currentStudentId, subject, semester, semAlt] : [subject, semester, semAlt];
    } else if (subject) {
        sql = `
            SELECT ${selectFields}
            FROM assignments a
            JOIN students s ON s.studentId = a.createdBy
            WHERE a.subject = ?
            ORDER BY a.createdAt DESC`;
        params = currentStudentId ? [currentStudentId, subject] : [subject];
    } else if (semester) {
        const semAlt = ROMAN_MAP[String(semester)] || NUM_MAP[String(semester)] || semester;
        sql = `
            SELECT ${selectFields}
            FROM assignments a
            JOIN students s ON s.studentId = a.createdBy
            WHERE (a.semester = ? OR a.semester = ?)
            ORDER BY a.createdAt DESC`;
        params = currentStudentId ? [currentStudentId, semester, semAlt] : [semester, semAlt];
    } else {
        sql = `
            SELECT ${selectFields}
            FROM assignments a
            JOIN students s ON s.studentId = a.createdBy
            ORDER BY a.createdAt DESC`;
        params = currentStudentId ? [currentStudentId] : [];
    }

    const assignments = await db.all(sql, ...params);
    let adminUser = false;
    if (currentStudentId) {
        adminUser = await isAdmin(currentStudentId);
    }
    const enriched = assignments.map(a => {
        const pUrl = a.pdfUrl || a.pdfurl || null;
        const pName = a.pdfName || a.pdfname || null;
        return {
            ...a,
            pdfUrl: pUrl,
            pdfName: pName,
            pdfurl: pUrl,
            pdfname: pName,
            canDelete: !!(currentStudentId && (a.createdBy === currentStudentId || adminUser))
        };
    });
    res.json(enriched);
});

// ── GET /my-assignments — admin's own assignments ──────────────────────────
router.get('/my-assignments', requireLogin, async (req, res) => {
    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can view this.' });
    }

    const assignments = await db.all(
        `SELECT a.*,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount
         FROM assignments a
         WHERE a.createdBy = ?
         ORDER BY a.createdAt DESC`,
        req.session.studentId
    );
    res.json(assignments.map(a => {
        const pUrl = a.pdfUrl || a.pdfurl || null;
        const pName = a.pdfName || a.pdfname || null;
        return {
            ...a,
            pdfUrl: pUrl,
            pdfName: pName,
            pdfurl: pUrl,
            pdfname: pName,
            canDelete: true
        };
    }));
});

// ── DELETE /assignments/:id — delete assignment and associated records ────────
router.delete('/assignments/:id', requireLogin, async (req, res) => {
    try {
        const assignmentId = Number(req.params.id);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
            return res.status(400).json({ message: 'Invalid assignment ID.' });
        }

        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found.' });
        }

        const admin = await isAdmin(req.session.studentId);
        if (assignment.createdBy !== req.session.studentId && !admin) {
            return res.status(403).json({ message: 'You are not authorized to delete this assignment.' });
        }

        // Clean up associated PDF file and blob if present
        const pdfUrl = assignment.pdfUrl || assignment.pdfurl;
        if (pdfUrl) {
            const pdfFilename = path.basename(pdfUrl);
            const localPdf = path.join(UPLOAD_DIR, pdfFilename);
            if (fs.existsSync(localPdf)) {
                try { fs.unlinkSync(localPdf); } catch (_) {}
            }
            try { await db.deleteFileBlob(pdfFilename); } catch (_) {}
        }

        // Delete associated records in cascade order
        await db.run('DELETE FROM submission_events WHERE assignmentId = ?', assignmentId);
        await db.run('DELETE FROM submissions WHERE assignmentId = ?', assignmentId);
        await db.run('DELETE FROM assignment_questions WHERE assignmentId = ?', assignmentId);
        await db.run('DELETE FROM assignments WHERE id = ?', assignmentId);

        res.json({ message: 'Assignment deleted successfully.', id: assignmentId });
    } catch (err) {
        console.error('[Code Lab] Delete assignment error:', err);
        res.status(500).json({ message: 'Failed to delete assignment.' });
    }
});

// ── GET /assignments/:id — single assignment with nested questions ──────────
router.get('/assignments/:id', async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        return res.status(400).json({ message: 'Invalid assignment ID.' });
    }

    const assignment = await db.get(
        `SELECT a.*, s.name AS teacherName
         FROM assignments a
         JOIN students s ON s.studentId = a.createdBy
         WHERE a.id = ?`,
        assignmentId
    );
    if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });

    const questions = await db.all(
        `SELECT aq.*,
                (SELECT COUNT(*) FROM question_test_cases qtc WHERE qtc.questionId = aq.id) AS testCaseCount
         FROM assignment_questions aq
         WHERE aq.assignmentId = ?
         ORDER BY aq.questionNumber ASC`,
        assignmentId
    );

    // Fetch student's existing submissions if logged in so their code is restored in editor
    const currentStudentId = req.session && req.session.studentId;
    let userSubmissions = [];
    let adminUser = false;
    if (currentStudentId) {
        userSubmissions = await db.all(
            'SELECT * FROM submissions WHERE assignmentId = ? AND studentId = ?',
            assignmentId, currentStudentId
        );
        adminUser = await isAdmin(currentStudentId);
    }
    const subMap = {};
    (userSubmissions || []).forEach(sub => {
        if (sub.questionId) subMap[sub.questionId] = sub;
    });

    const questionsWithSub = questions.map(q => {
        const sub = subMap[q.id];
        let parsedResults = null;
        if (sub && sub.testResults) {
            try {
                parsedResults = typeof sub.testResults === 'string' ? JSON.parse(sub.testResults) : sub.testResults;
            } catch (_) {}
        }
        return {
            ...q,
            testCaseCount: Number(q.testCaseCount || 0),
            userSubmission: sub ? {
                id: sub.id,
                code: sub.code,
                stdout: sub.stdout,
                stderr: sub.stderr,
                questionTitle: sub.questionTitle || null,
                testResults: parsedResults,
                submittedAt: sub.submittedAt
            } : null
        };
    });

    const resolvedPdfUrl = assignment.pdfUrl || assignment.pdfurl || null;
    const resolvedPdfName = assignment.pdfName || assignment.pdfname || null;

    res.json({
        ...assignment,
        pdfUrl: resolvedPdfUrl,
        pdfName: resolvedPdfName,
        pdfurl: resolvedPdfUrl,
        pdfname: resolvedPdfName,
        canDelete: !!(currentStudentId && (assignment.createdBy === currentStudentId || adminUser)),
        currentStudentId: currentStudentId || null,
        questions: questionsWithSub
    });
});

// ── POST /questions/:questionId/submissions — student submits for ONE question
router.post('/questions/:questionId/submissions', requireLogin, async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ message: 'Invalid question ID.' });
    }

    const { code, stdout, stderr, questionTitle } = req.body;
    if (typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: 'Code is required.' });
    }

    try {
        // Look up assignment and language from question
        const question = await db.get('SELECT assignmentId, language FROM assignment_questions WHERE id = ?', questionId);
        if (!question) {
            return res.status(404).json({ message: 'Question not found.' });
        }

        const now = new Date().toISOString();
        const safeTitle = (questionTitle && typeof questionTitle === 'string' && questionTitle.trim()) ? questionTitle.trim() : null;

        // Check for test cases and evaluate server-side
        const testCases = await db.all('SELECT * FROM question_test_cases WHERE questionId = ? ORDER BY id ASC', questionId);
        let testResults = null;
        if (testCases && testCases.length > 0) {
            testResults = await runTestCases(question.language, code, testCases);
        }
        const testResultsJson = testResults ? JSON.stringify(testResults) : null;

        // Atomic upsert compatible with partial unique index
        await db.run(`
            INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, questionTitle, submittedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (assignmentId, studentId, questionId) WHERE questionId IS NOT NULL
            DO UPDATE SET
                code = excluded.code,
                stdout = excluded.stdout,
                stderr = excluded.stderr,
                testResults = excluded.testResults,
                questionTitle = COALESCE(excluded.questionTitle, submissions.questionTitle),
                submittedAt = excluded.submittedAt
        `, question.assignmentId, questionId, req.session.studentId, code, stdout || '', stderr || '', testResultsJson, safeTitle || null, now);

        // Note: Students retain their custom question title in their submission record,
        // but shared assignment_questions.title is preserved to protect all other students.

        res.json({ message: 'Submitted successfully', testResults, questionTitle: finalTitle });
    } catch (err) {
        console.error(`[Code Lab][POST /questions/${questionId}/submissions] studentId=${req.session.studentId}:`, err);
        res.status(500).json({ message: 'Failed to submit code.' });
    }
});

// ── POST /assignments/:id/student-questions — add question solution slot for PDF assignment ──
router.post('/assignments/:id/student-questions', requireLogin, async (req, res) => {
    try {
        const assignmentId = Number(req.params.id);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
            return res.status(400).json({ message: 'Invalid assignment ID.' });
        }

        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found.' });
        }

        const admin = await isAdmin(req.session.studentId);
        if (!admin && assignment.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'Only admins or the assignment creator can add questions.' });
        }

        const { title, language } = req.body;
        const countRow = await db.get('SELECT COUNT(*) AS cnt FROM assignment_questions WHERE assignmentId = ?', assignmentId);
        const nextQNum = (Number(countRow?.cnt) || 0) + 1;
        const qTitle = (title && typeof title === 'string' && title.trim()) ? title.trim() : `Question ${nextQNum}`;
        const qLang = language || assignment.language || 'c';
        const now = new Date().toISOString();

        const result = await db.run(
            'INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, maxPoints, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
            assignmentId,
            nextQNum,
            qTitle,
            'Question solution from attached PDF',
            qLang,
            10,
            now
        );

        const newQId = result.lastInsertRowid;

        res.json({
            success: true,
            question: {
                id: newQId,
                assignmentId,
                questionNumber: nextQNum,
                title: qTitle,
                description: 'Question solution from attached PDF',
                language: qLang,
                maxPoints: 10,
                testCaseCount: 0,
                userSubmission: null
            }
        });
    } catch (err) {
        console.error('[Code Lab] Add student question error:', err);
        res.status(500).json({ message: 'Failed to add question.' });
    }
});

// ── Legacy POST /submissions — keep for backward compat ────────────────────
router.post('/submissions', requireLogin, async (req, res) => {
    try {
        const { assignmentId, code, stdout, stderr } = req.body;
        const validAssignmentId = Number(assignmentId);
        if (!Number.isInteger(validAssignmentId) || validAssignmentId <= 0 || typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ message: 'Assignment ID and code are required.' });
        }

        const now = new Date().toISOString();

        // Look up primary question for test cases
        const firstQ = await db.get(
            'SELECT id, language FROM assignment_questions WHERE assignmentId = ? ORDER BY questionNumber ASC LIMIT 1',
            validAssignmentId
        );
        let testResults = null;
        if (firstQ) {
            const testCases = await db.all('SELECT * FROM question_test_cases WHERE questionId = ? ORDER BY id ASC', firstQ.id);
            if (testCases && testCases.length > 0) {
                testResults = await runTestCases(firstQ.language, code, testCases);
            }
        }
        const testResultsJson = testResults ? JSON.stringify(testResults) : null;

        const targetQId = firstQ ? firstQ.id : null;
        if (targetQId) {
            await db.run(`
                INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, submittedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (assignmentId, studentId, questionId) WHERE questionId IS NOT NULL
                DO UPDATE SET
                    code = excluded.code,
                    stdout = excluded.stdout,
                    stderr = excluded.stderr,
                    testResults = excluded.testResults,
                    submittedAt = excluded.submittedAt
            `, validAssignmentId, targetQId, req.session.studentId, code, stdout || '', stderr || '', testResultsJson, now);
        } else {
            await db.run(`
                INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, testResults, submittedAt)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (assignmentId, studentId) WHERE questionId IS NULL
                DO UPDATE SET
                    code = excluded.code,
                    stdout = excluded.stdout,
                    stderr = excluded.stderr,
                    testResults = excluded.testResults,
                    submittedAt = excluded.submittedAt
            `, validAssignmentId, req.session.studentId, code, stdout || '', stderr || '', testResultsJson, now);
        }

        res.json({ message: 'Submitted successfully', testResults });
    } catch (err) {
        console.error(`[Code Lab][POST /submissions] studentId=${req.session.studentId}, assignmentId=${req.body.assignmentId}:`, err);
        res.status(500).json({ message: 'Failed to submit code.' });
    }
});

// ── GET /assignments/:id/submissions — grouped by student, per-question ─────
router.get('/assignments/:id/submissions', requireLogin, async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        return res.status(400).json({ message: 'Invalid assignment ID.' });
    }

    const admin = await isAdmin(req.session.studentId);
    const assignment = await db.get(
        `SELECT a.id, a.title, a.subject, a.semester, a.deadline, a.pdfUrl, a.pdfName, a.createdBy, s.name AS teacherName,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignmentId = a.id) AS questionCount
         FROM assignments a
         LEFT JOIN students s ON s.studentId = a.createdBy
         WHERE a.id = ?`,
        assignmentId
    );
    if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found.' });
    }

    if (!admin && assignment.createdBy !== req.session.studentId) {
        return res.status(403).json({ message: 'Only admins or the assignment creator can view submissions.' });
    }

    const assignmentQuestions = await db.all(
        `SELECT id, questionNumber, title, description, language, COALESCE(maxPoints, 10) AS maxPoints
         FROM assignment_questions
         WHERE assignmentId = ?
         ORDER BY questionNumber ASC`,
        assignmentId
    );

    // Fetch all submissions with question info, grouped by student
    const submissions = await db.all(
        `SELECT sub.*, 
                st.name AS studentName,
                aq.questionNumber, COALESCE(sub.questionTitle, aq.title, 'Question') AS questionTitle, aq.language AS questionLanguage,
                COALESCE(aq.maxPoints, 10) AS maxPoints,
                (SELECT COUNT(*) FROM question_test_cases qtc WHERE qtc.questionId = aq.id) AS testCaseCount,
                sg.marksObtained, sg.remarks, sg.checked, sg.released, sg.gradedBy, sg.gradedAt
         FROM submissions sub
         JOIN students st ON st.studentId = sub.studentId
         LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
         LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
         WHERE sub.assignmentId = ?
         ORDER BY st.name ASC, aq.questionNumber ASC`,
        assignmentId
    );

    // Group by student
    const grouped = {};
    submissions.forEach(s => {
        if (!grouped[s.studentId]) {
            grouped[s.studentId] = {
                studentId: s.studentId,
                studentName: s.studentName,
                submissions: []
            };
        }
        let parsedResults = null;
        if (s.testResults) {
            try {
                parsedResults = typeof s.testResults === 'string' ? JSON.parse(s.testResults) : s.testResults;
            } catch (_) {}
        }
        grouped[s.studentId].submissions.push({
            id: s.id,
            questionId: s.questionId,
            questionNumber: s.questionNumber || 1,
            questionTitle: s.questionTitle || 'Question',
            questionLanguage: s.questionLanguage,
            maxPoints: s.maxPoints != null ? s.maxPoints : 10,
            marksObtained: s.marksObtained !== undefined ? s.marksObtained : null,
            remarks: s.remarks || null,
            checked: Boolean(s.checked),
            released: Boolean(s.released),
            gradedBy: s.gradedBy || null,
            gradedAt: s.gradedAt || null,
            code: s.code,
            stdout: s.stdout,
            stderr: s.stderr,
            testResults: parsedResults,
            testCaseCount: Number(s.testCaseCount || 0),
            submittedAt: s.submittedAt
        });
    });

    res.json({
        assignment: {
            id: assignment.id,
            title: assignment.title,
            subject: assignment.subject,
            semester: assignment.semester,
            deadline: assignment.deadline,
            teacherName: assignment.teacherName,
            createdBy: assignment.createdBy,
            questionCount: Number(assignment.questionCount || 0),
            questions: assignmentQuestions
        },
        students: Object.values(grouped)
    });
});

// ── Code Similarity Helper Functions ─────────────────────────────────────────
function normalizeCode(code) {
    if (!code || typeof code !== 'string') return '';
    // Strip multi-line comments /* ... */ and single-line comments // ... or # ...
    const stripped = code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*/g, ' ')
        .replace(/#.*/g, ' ');
    // Normalize whitespace to single spaces and lowercase
    return stripped.replace(/\s+/g, ' ').trim().toLowerCase();
}

function computeSimilarity(codeA, codeB) {
    const cleanA = normalizeCode(codeA);
    const cleanB = normalizeCode(codeB);
    if (!cleanA || !cleanB) return 0;
    if (cleanA === cleanB) return 1.0;

    const tokensA = cleanA.match(/[\w$]+|[^\s\w]/g) || [];
    const tokensB = cleanB.match(/[\w$]+|[^\s\w]/g) || [];
    if (!tokensA.length || !tokensB.length) return 0;

    // Use token bigrams for structure-preserving Jaccard similarity
    if (tokensA.length >= 3 && tokensB.length >= 3) {
        const setA = new Set();
        for (let i = 0; i < tokensA.length - 1; i++) {
            setA.add(tokensA[i] + ' ' + tokensA[i + 1]);
        }
        const setB = new Set();
        for (let i = 0; i < tokensB.length - 1; i++) {
            setB.add(tokensB[i] + ' ' + tokensB[i + 1]);
        }
        let intersection = 0;
        setA.forEach(item => {
            if (setB.has(item)) intersection++;
        });
        const union = setA.size + setB.size - intersection;
        return union > 0 ? (intersection / union) : 0;
    } else {
        // Fallback to unigram Jaccard for very short snippets
        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        let intersection = 0;
        setA.forEach(item => {
            if (setB.has(item)) intersection++;
        });
        const union = setA.size + setB.size - intersection;
        return union > 0 ? (intersection / union) : 0;
    }
}

// ── GET /questions/:questionId/similarity — admin or assignment creator only ─
router.get('/questions/:questionId/similarity', requireLogin, async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ message: 'Invalid question ID.' });
    }

    const question = await db.get(
        `SELECT aq.id, aq.assignmentId, aq.questionNumber, aq.title, a.createdBy
         FROM assignment_questions aq
         JOIN assignments a ON a.id = aq.assignmentId
         WHERE aq.id = ?`,
        questionId
    );
    if (!question) {
        return res.status(404).json({ message: 'Question not found.' });
    }

    const admin = await isAdmin(req.session.studentId);
    if (!admin && question.createdBy !== req.session.studentId) {
        return res.status(403).json({ message: 'Only admins or the assignment creator can view similarity.' });
    }

    // Threshold can be provided in query (default 0.85 = 85%)
    const rawThreshold = parseFloat(req.query.threshold);
    const threshold = (!isNaN(rawThreshold) && rawThreshold > 0 && rawThreshold <= 1) ? rawThreshold : 0.85;

    // Fetch all submissions for this question
    const submissions = await db.all(
        `SELECT sub.studentId, sub.code, st.name AS studentName
         FROM submissions sub
         JOIN students st ON st.studentId = sub.studentId
         WHERE sub.questionId = ? AND sub.code IS NOT NULL AND TRIM(sub.code) != ''
         ORDER BY st.name ASC`,
        questionId
    );

    const warnings = [];
    for (let i = 0; i < submissions.length; i++) {
        for (let j = i + 1; j < submissions.length; j++) {
            const subA = submissions[i];
            const subB = submissions[j];
            const score = computeSimilarity(subA.code, subB.code);
            if (score >= threshold) {
                warnings.push({
                    questionId: question.id,
                    questionNumber: question.questionNumber,
                    questionTitle: question.title,
                    studentA: subA.studentId,
                    studentAName: subA.studentName,
                    studentB: subB.studentId,
                    studentBName: subB.studentName,
                    similarity: Math.round(score * 100) / 100,
                    similarityPercent: Math.round(score * 100),
                    codeA: subA.code,
                    codeB: subB.code
                });
            }
        }
    }

    warnings.sort((a, b) => b.similarity - a.similarity);
    res.json(warnings);
});

// ── GET /my-submissions — student's own submissions with question info ──────
router.get('/my-submissions', requireLogin, async (req, res) => {
    const submissions = await db.all(`
    SELECT sub.*, a.title AS assignmentTitle, a.subject, a.semester, a.deadline, a.createdBy,
           t.name AS teacherName,
           st.name AS studentName,
           aq.title AS questionTitle, aq.questionNumber, aq.language,
           COALESCE(aq.maxPoints, 10) AS maxPoints,
           sg.marksObtained, sg.remarks, sg.checked, sg.released
    FROM submissions sub
    JOIN assignments a ON a.id = sub.assignmentId
    LEFT JOIN students t ON t.studentId = a.createdBy
    LEFT JOIN students st ON st.studentId = sub.studentId
    LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
    LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
    WHERE sub.studentId = ?
    ORDER BY sub.submittedAt DESC
  `, req.session.studentId);

    const sanitized = submissions.map(s => {
        const isReleased = Boolean(s.released);
        return {
            ...s,
            assignmentTitle: s.assignmentTitle || s.assignmenttitle || 'Assignment',
            studentId: s.studentId || s.studentid || req.session.studentId,
            studentName: s.studentName || s.studentname || req.session.name || 'Student',
            teacherName: s.teacherName || s.teachername || 'Instructor',
            createdBy: s.createdBy || s.createdby,
            assignmentId: s.assignmentId || s.assignmentid,
            questionId: s.questionId || s.questionid,
            questionNumber: s.questionNumber || s.questionnumber,
            questionTitle: s.questionTitle || s.questiontitle,
            maxPoints: s.maxPoints != null ? s.maxPoints : (s.maxpoints != null ? s.maxpoints : 10),
            marksObtained: isReleased ? (s.marksObtained != null ? s.marksObtained : s.marksobtained) : null,
            remarks: isReleased ? s.remarks : null,
            checked: isReleased ? Boolean(s.checked) : false,
            released: isReleased
        };
    });

    res.json(sanitized);
});

// ── POST /events — student's browser posts a batch of events ────────────────
router.post('/events', requireLogin, async (req, res) => {
    try {
        const { assignmentId, questionId, events } = req.body;
        const studentId = req.session.studentId;

        if ((!assignmentId && !questionId) || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ message: 'assignmentId (or questionId) and a non-empty events array are required.' });
        }

        // Resolve assignmentId from questionId if needed
        let resolvedAssignmentId = assignmentId;
        if (questionId && !assignmentId) {
            const q = await db.get('SELECT assignmentId FROM assignment_questions WHERE id = ?', questionId);
            if (q) resolvedAssignmentId = q.assignmentId;
        }

        if (!resolvedAssignmentId) {
            return res.status(400).json({ message: 'Could not resolve assignmentId.' });
        }

        const safeEvents = events.slice(0, 200);
        const now = new Date().toISOString();

        for (const ev of safeEvents) {
            const eventType = String(ev.type || 'unknown').slice(0, 40);
            let payload = '';
            try {
                payload = JSON.stringify(ev.payload || {}).slice(0, 8000);
            } catch (e) {
                payload = '';
            }
            const clientTime = ev.clientTime ? String(ev.clientTime).slice(0, 40) : null;

            await db.run(
                `INSERT INTO submission_events (assignmentId, questionId, studentId, eventType, payload, clientTime, serverReceivedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                resolvedAssignmentId, questionId || null, studentId, eventType, payload, clientTime, now, now
            );
        }

        res.json({ success: true, stored: safeEvents.length });
    } catch (err) {
        console.error('[Code Lab] Event logging error:', err);
        res.status(500).json({ message: 'Failed to store events.' });
    }
});

// ── GET /questions/:questionId/events/:studentId — per-question event log ───
router.get('/questions/:questionId/events/:studentId', requireLogin, async (req, res) => {
    try {
        const questionId = Number(req.params.questionId);
        const studentId = req.params.studentId;
        const currentStudentId = req.session.studentId;

        const isSelf = String(currentStudentId) === String(studentId);
        const admin = await isAdmin(currentStudentId);

        if (!isSelf && !admin) {
            return res.status(403).json({ message: 'Only teachers or the student themselves can view event logs.' });
        }

        const question = await db.get(
            'SELECT aq.*, a.createdBy FROM assignment_questions aq JOIN assignments a ON a.id = aq.assignmentId WHERE aq.id = ?',
            questionId
        );
        if (!question) {
            return res.status(404).json({ message: 'Question not found.' });
        }
        if (!isSelf && question.createdBy !== currentStudentId) {
            return res.status(403).json({ message: 'You can only view events for your own assignments.' });
        }

        const events = await db.all(
            `SELECT * FROM submission_events WHERE questionId = ? AND studentId = ? ORDER BY id ASC`,
            questionId, studentId
        );

        res.json(events);
    } catch (err) {
        console.error('[Code Lab] Fetch events error:', err);
        res.status(500).json({ message: 'Failed to load events.' });
    }
});

// ── GET /assignments/:id/events/:studentId — legacy route (all events for assignment) ──
router.get('/assignments/:id/events/:studentId', requireLogin, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const studentId = req.params.studentId;
        const isSelf = String(req.session.studentId) === String(studentId);
        const admin = await isAdmin(req.session.studentId);

        if (!isSelf && !admin) {
            return res.status(403).json({ message: 'Only teachers or the student themselves can view event logs.' });
        }

        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found.' });
        }
        if (!isSelf && assignment.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'You can only view events for your own assignments.' });
        }

        const events = await db.all(
            `SELECT * FROM submission_events WHERE assignmentId = ? AND studentId = ? ORDER BY id ASC`,
            assignmentId, studentId
        );

        res.json(events);
    } catch (err) {
        console.error(`[Code Lab][GET /assignments/${req.params.id}/events/${req.params.studentId}]:`, err);
        res.status(500).json({ message: 'Failed to load events.' });
    }
});

// ── Test Cases CRUD Endpoints ───────────────────────────────────────────────
// POST /questions/:questionId/test-cases — admin/creator only
router.post('/questions/:questionId/test-cases', requireLogin, async (req, res) => {
    try {
        const questionId = Number(req.params.questionId);
        if (!Number.isInteger(questionId) || questionId <= 0) {
            return res.status(400).json({ message: 'Invalid question ID.' });
        }

        const question = await db.get(
            `SELECT aq.id, aq.assignmentId, a.createdBy 
             FROM assignment_questions aq 
             JOIN assignments a ON a.id = aq.assignmentId 
             WHERE aq.id = ?`,
            questionId
        );
        if (!question) {
            return res.status(404).json({ message: 'Question not found.' });
        }

        const admin = await isAdmin(req.session.studentId);
        if (!admin && question.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'Only admins or the assignment creator can manage test cases.' });
        }

        // Accept single object or array
        const rawCases = Array.isArray(req.body) ? req.body : (Array.isArray(req.body.testCases) ? req.body.testCases : [req.body]);
        const validCases = rawCases.filter(tc => tc && tc.expectedOutput != null && String(tc.expectedOutput).trim().length > 0);

        if (validCases.length === 0) {
            return res.status(400).json({ message: 'At least one valid test case with expectedOutput is required.' });
        }

        const now = new Date().toISOString();
        const insertedIds = [];

        for (const tc of validCases) {
            const ins = await db.run(
                'INSERT INTO question_test_cases (questionId, input, expectedOutput, createdAt) VALUES (?, ?, ?, ?)',
                questionId,
                tc.input != null ? String(tc.input) : '',
                String(tc.expectedOutput).trim(),
                now
            );
            insertedIds.push(ins.lastInsertRowid);
        }

        res.json({ message: 'Test case(s) added successfully', count: insertedIds.length, ids: insertedIds });
    } catch (err) {
        console.error(`[Code Lab][POST /questions/${req.params.questionId}/test-cases] studentId=${req.session.studentId}:`, err);
        res.status(500).json({ message: 'Failed to add test cases.' });
    }
});

// GET /questions/:questionId/test-cases
router.get('/questions/:questionId/test-cases', requireLogin, async (req, res) => {
    try {
        const questionId = Number(req.params.questionId);
        if (!Number.isInteger(questionId) || questionId <= 0) {
            return res.status(400).json({ message: 'Invalid question ID.' });
        }

        const testCases = await db.all(
            'SELECT id, questionId, input, expectedOutput, createdAt FROM question_test_cases WHERE questionId = ? ORDER BY id ASC',
            questionId
        );
        res.json(testCases);
    } catch (err) {
        console.error(`[Code Lab][GET /questions/${req.params.questionId}/test-cases]:`, err);
        res.status(500).json({ message: 'Failed to load test cases.' });
    }
});

// DELETE /questions/:questionId/test-cases/:testCaseId
router.delete('/questions/:questionId/test-cases/:testCaseId', requireLogin, async (req, res) => {
    try {
        const questionId = Number(req.params.questionId);
        const testCaseId = Number(req.params.testCaseId);
        if (!Number.isInteger(questionId) || !Number.isInteger(testCaseId)) {
            return res.status(400).json({ message: 'Invalid IDs.' });
        }

        const question = await db.get(
            `SELECT aq.id, a.createdBy FROM assignment_questions aq JOIN assignments a ON a.id = aq.assignmentId WHERE aq.id = ?`,
            questionId
        );
        if (!question) return res.status(404).json({ message: 'Question not found.' });

        const admin = await isAdmin(req.session.studentId);
        if (!admin && question.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'Permission denied.' });
        }

        await db.run('DELETE FROM question_test_cases WHERE id = ? AND questionId = ?', testCaseId, questionId);
        res.json({ message: 'Test case deleted successfully.' });
    } catch (err) {
        console.error(`[Code Lab][DELETE /questions/${req.params.questionId}/test-cases/${req.params.testCaseId}]:`, err);
        res.status(500).json({ message: 'Failed to delete test case.' });
    }
});

// ── PATCH /questions/:questionId — update question's maxPoints (admin / creator only) ──
router.patch('/questions/:questionId', requireLogin, async (req, res) => {
    try {
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can update questions.' });
        }

        const questionId = Number(req.params.questionId);
        if (!Number.isInteger(questionId) || questionId <= 0) {
            return res.status(400).json({ message: 'Invalid question ID.' });
        }

        const { maxPoints } = req.body;
        const parsedPoints = Number(maxPoints);
        if (isNaN(parsedPoints) || parsedPoints < 1) {
            return res.status(400).json({ message: 'maxPoints must be a positive number.' });
        }

        const question = await db.get(
            `SELECT aq.*, a.createdBy FROM assignment_questions aq
             JOIN assignments a ON a.id = aq.assignmentId
             WHERE aq.id = ?`,
            questionId
        );
        if (!question) return res.status(404).json({ message: 'Question not found.' });
        if (question.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'You can only edit your own questions.' });
        }

        await db.run('UPDATE assignment_questions SET maxPoints = ? WHERE id = ?', Math.floor(parsedPoints), questionId);
        res.json({ message: 'Question updated.', maxPoints: Math.floor(parsedPoints) });
    } catch (err) {
        console.error(`[Code Lab][PATCH /questions/${req.params.questionId}]:`, err);
        res.status(500).json({ message: 'Failed to update question.' });
    }
});

// ── PUT /questions/:questionId/grade/:studentId — grade submission (admin / creator only) ──
router.put('/questions/:questionId/grade/:studentId', requireLogin, async (req, res) => {
    try {
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can grade submissions.' });
        }

        const questionId = Number(req.params.questionId);
        const studentId = req.params.studentId;
        const { marksObtained, remarks, checked, released } = req.body;

        // Verify this teacher owns the assignment this question belongs to
        const question = await db.get(
            `SELECT aq.*, a.createdBy FROM assignment_questions aq
             JOIN assignments a ON a.id = aq.assignmentId
             WHERE aq.id = ?`,
            questionId
        );
        if (!question) return res.status(404).json({ message: 'Question not found.' });
        if (question.createdBy !== req.session.studentId && !admin) {
            return res.status(403).json({ message: 'You can only grade your own assignments.' });
        }

        const maxPts = question.maxPoints != null ? question.maxPoints : 10;

        // Validate marksObtained doesn't exceed maxPoints, if provided
        if (marksObtained !== null && marksObtained !== undefined && marksObtained !== '') {
            const num = Number(marksObtained);
            if (isNaN(num) || num < 0 || num > maxPts) {
                return res.status(400).json({ message: `Marks must be between 0 and ${maxPts}.` });
            }
        }

        const parsedMarks = (marksObtained !== null && marksObtained !== undefined && marksObtained !== '')
            ? Number(marksObtained)
            : null;

        const now = new Date().toISOString();

        if (db.isPostgres) {
            await db.run(
                `INSERT INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy, gradedAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (questionId, studentId)
                 DO UPDATE SET marksObtained = EXCLUDED.marksObtained, remarks = EXCLUDED.remarks,
                                checked = EXCLUDED.checked, released = EXCLUDED.released,
                                gradedBy = EXCLUDED.gradedBy, gradedAt = EXCLUDED.gradedAt, updatedAt = EXCLUDED.updatedAt`,
                questionId, studentId, parsedMarks, remarks ? String(remarks).trim() : null,
                !!checked, !!released, req.session.studentId, now, now
            );
        } else {
            await db.run(
                `INSERT OR REPLACE INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy, gradedAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                questionId, studentId, parsedMarks, remarks ? String(remarks).trim() : null,
                checked ? 1 : 0, released ? 1 : 0, req.session.studentId, now, now
            );
        }

        res.json({ message: 'Grade saved.' });
    } catch (err) {
        console.error(`[Code Lab][PUT /questions/${req.params.questionId}/grade/${req.params.studentId}]:`, err);
        res.status(500).json({ message: 'Failed to save grade.' });
    }
});

// ── POST /assignments/:id/release-grades — bulk release reviewed grades ──
router.post('/assignments/:id/release-grades', requireLogin, async (req, res) => {
    try {
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can release grades.' });
        }

        const assignmentId = Number(req.params.id);
        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
        if (assignment.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'You can only release grades for your own assignments.' });
        }

        const now = new Date().toISOString();
        if (db.isPostgres) {
            await db.run(
                `UPDATE submission_grades
                 SET released = TRUE, updatedAt = ?
                 WHERE (checked = TRUE OR checked IS TRUE) AND questionId IN (SELECT id FROM assignment_questions WHERE assignmentId = ?)`,
                now, assignmentId
            );
        } else {
            await db.run(
                `UPDATE submission_grades
                 SET released = 1, updatedAt = ?
                 WHERE checked = 1 AND questionId IN (SELECT id FROM assignment_questions WHERE assignmentId = ?)`,
                now, assignmentId
            );
        }

        res.json({ message: 'All reviewed grades released to students.' });
    } catch (err) {
        console.error(`[Code Lab][POST /assignments/${req.params.id}/release-grades]:`, err);
        res.status(500).json({ message: 'Failed to release grades.' });
    }
});

// ── GET /assignments/:id/report/:studentId — dedicated report data for teacher & student ──
router.get('/assignments/:id/report/:studentId', requireLogin, async (req, res) => {
    try {
        const assignmentId = Number(req.params.id);
        const studentId = String(req.params.studentId);
        const currentStudentId = String(req.session.studentId);

        const assignment = await db.get(
            `SELECT a.id, a.title, a.subject, a.semester, a.deadline, a.pdfUrl, a.pdfName, a.createdBy, s.name AS teacherName
             FROM assignments a
             LEFT JOIN students s ON s.studentId = a.createdBy
             WHERE a.id = ?`,
            assignmentId
        );
        if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });

        const admin = await isAdmin(currentStudentId);
        const isTeacher = admin || assignment.createdBy === currentStudentId;
        const isSelf = currentStudentId === studentId;

        if (!isTeacher && !isSelf) {
            return res.status(403).json({ message: 'You do not have permission to view this report.' });
        }

        const student = await db.get('SELECT studentId, name FROM students WHERE studentId = ?', studentId);
        if (!student) return res.status(404).json({ message: 'Student not found.' });

        const questions = await db.all(
            `SELECT id, questionNumber, title, description, language, COALESCE(maxPoints, 10) AS maxPoints
             FROM assignment_questions
             WHERE assignmentId = ?
             ORDER BY questionNumber ASC`,
            assignmentId
        );

        const submissions = await db.all(
            `SELECT sub.*, 
                    aq.questionNumber, COALESCE(sub.questionTitle, aq.title, 'Question') AS questionTitle, aq.language AS questionLanguage,
                    COALESCE(aq.maxPoints, 10) AS maxPoints,
                    (SELECT COUNT(*) FROM question_test_cases qtc WHERE qtc.questionId = aq.id) AS testCaseCount,
                    sg.marksObtained, sg.remarks, sg.checked, sg.released, sg.gradedBy, sg.gradedAt
             FROM submissions sub
             LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
             LEFT JOIN submission_grades sg ON sg.questionId = sub.questionId AND sg.studentId = sub.studentId
             WHERE sub.assignmentId = ? AND sub.studentId = ?
             ORDER BY aq.questionNumber ASC`,
            assignmentId, studentId
        );

        const sanitizedSubmissions = submissions.map(s => {
            let parsedResults = null;
            if (s.testResults) {
                try {
                    parsedResults = typeof s.testResults === 'string' ? JSON.parse(s.testResults) : s.testResults;
                } catch (_) {}
            }
            const isReleased = Boolean(s.released);
            const allowGrades = isTeacher || isReleased;

            return {
                id: s.id,
                questionId: s.questionId,
                questionNumber: s.questionNumber || 1,
                questionTitle: s.questionTitle || 'Question',
                questionLanguage: s.questionLanguage,
                code: s.code,
                stdout: s.stdout,
                stderr: s.stderr,
                submittedAt: s.submittedAt,
                testResults: parsedResults,
                testCaseCount: s.testCaseCount || (parsedResults ? parsedResults.length : 0),
                maxPoints: s.maxPoints != null ? s.maxPoints : 10,
                marksObtained: allowGrades ? (s.marksObtained !== undefined ? s.marksObtained : null) : null,
                remarks: allowGrades ? (s.remarks || null) : null,
                checked: allowGrades ? Boolean(s.checked) : false,
                released: isReleased,
                gradedBy: allowGrades ? (s.gradedBy || null) : null,
                gradedAt: allowGrades ? (s.gradedAt || null) : null
            };
        });

        res.json({
            isTeacher,
            assignment,
            questions,
            studentData: {
                studentId: student.studentId,
                studentName: student.name,
                name: student.name,
                submissions: sanitizedSubmissions
            }
        });
    } catch (err) {
        console.error(`[Code Lab][GET /assignments/${req.params.id}/report/${req.params.studentId}]:`, err);
        res.status(500).json({ message: 'Failed to load report data.' });
    }
});

// ── POST /assignments/:id/grade-student/:studentId — save draft / submit grades from report ──
router.post('/assignments/:id/grade-student/:studentId', requireLogin, async (req, res) => {
    try {
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only admins can grade submissions.' });
        }

        const assignmentId = Number(req.params.id);
        const studentId = String(req.params.studentId);
        const { grades, release } = req.body; // grades: [{ questionId, marksObtained, remarks, checked }]

        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
        if (assignment.createdBy !== req.session.studentId && !admin) {
            return res.status(403).json({ message: 'You can only grade your own assignments.' });
        }

        if (!Array.isArray(grades) || grades.length === 0) {
            return res.status(400).json({ message: 'Grades array is required.' });
        }

        const now = new Date().toISOString();

        for (const g of grades) {
            const questionId = Number(g.questionId);
            const question = await db.get('SELECT * FROM assignment_questions WHERE id = ? AND assignmentId = ?', questionId, assignmentId);
            if (!question) continue;

            const maxPts = question.maxPoints != null ? question.maxPoints : 10;
            let marks = g.marksObtained;
            if (marks !== null && marks !== undefined && marks !== '') {
                marks = Number(marks);
                if (isNaN(marks) || marks < 0 || marks > maxPts) {
                    return res.status(400).json({ message: `Marks for Question ${question.questionNumber || questionId} must be between 0 and ${maxPts}.` });
                }
            } else {
                marks = null;
            }

            const checked = Boolean(g.checked);
            const released = Boolean(release);

            if (db.isPostgres) {
                await db.run(
                    `INSERT INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy, gradedAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (questionId, studentId)
                     DO UPDATE SET marksObtained = EXCLUDED.marksObtained, remarks = EXCLUDED.remarks,
                                    checked = EXCLUDED.checked, released = EXCLUDED.released,
                                    gradedBy = EXCLUDED.gradedBy, gradedAt = EXCLUDED.gradedAt, updatedAt = EXCLUDED.updatedAt`,
                    questionId, studentId, marks, g.remarks || null,
                    checked, released, req.session.studentId, now, now
                );
            } else {
                await db.run(
                    `INSERT OR REPLACE INTO submission_grades (questionId, studentId, marksObtained, remarks, checked, released, gradedBy, gradedAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    questionId, studentId, marks, g.remarks || null,
                    checked ? 1 : 0, released ? 1 : 0, req.session.studentId, now, now
                );
            }
        }

        res.json({
            message: release ? 'Grades and report submitted to student successfully.' : 'Grading draft saved successfully.',
            released: Boolean(release)
        });
    } catch (err) {
        console.error(`[Code Lab][POST /assignments/${req.params.id}/grade-student/${req.params.studentId}]:`, err);
        res.status(500).json({ message: 'Failed to save grades.' });
    }
});

module.exports = router;

