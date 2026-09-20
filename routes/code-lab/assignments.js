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

    const { title, subject, semester, questions } = req.body;
    if (!title) {
        return res.status(400).json({ message: 'Assignment title is required.' });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: 'At least one question is required.' });
    }

    // Validate each question: Title is compulsory, Problem Statement / Description is optional
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.title || !q.title.trim()) {
            return res.status(400).json({ message: `Question ${i + 1}: Question title is compulsory.` });
        }
    }

    const now = new Date().toISOString();

    // Use first question's description/language as fallback for the legacy columns
    const result = await db.run(
        'INSERT INTO assignments (title, description, language, subject, semester, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        title,
        questions[0].description ? questions[0].description.trim() : '',
        questions[0].language || 'c',
        subject || null,
        semester || null,
        req.session.studentId,
        now
    );

    const assignmentId = result.lastInsertRowid;

    // Create question rows
    const questionIds = [];
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qResult = await db.run(
            'INSERT INTO assignment_questions (assignmentId, questionNumber, title, description, language, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
            assignmentId,
            i + 1,
            q.title.trim(),
            q.description ? q.description.trim() : '',
            q.language || 'c',
            now
        );
        questionIds.push(qResult.lastInsertRowid);
    }

    res.json({ message: 'Assignment created', id: assignmentId, questionIds });
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
    res.json(assignments);
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
    res.json(assignments);
});

// ── GET /assignments/:id — single assignment with nested questions ──────────
router.get('/assignments/:id', requireLogin, async (req, res) => {
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
        'SELECT * FROM assignment_questions WHERE assignmentId = ? ORDER BY questionNumber ASC',
        assignmentId
    );

    // Fetch student's existing submissions for this assignment so their code is restored in editor
    const userSubmissions = await db.all(
        'SELECT * FROM submissions WHERE assignmentId = ? AND studentId = ?',
        assignmentId, req.session.studentId
    );
    const subMap = {};
    (userSubmissions || []).forEach(sub => {
        if (sub.questionId) subMap[sub.questionId] = sub;
    });

    const questionsWithSub = questions.map(q => ({
        ...q,
        userSubmission: subMap[q.id] ? {
            id: subMap[q.id].id,
            code: subMap[q.id].code,
            stdout: subMap[q.id].stdout,
            stderr: subMap[q.id].stderr,
            submittedAt: subMap[q.id].submittedAt
        } : null
    }));

    res.json({ ...assignment, questions: questionsWithSub });
});

// ── POST /questions/:questionId/submissions — student submits for ONE question
router.post('/questions/:questionId/submissions', requireLogin, async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ message: 'Invalid question ID.' });
    }

    const { code, stdout, stderr } = req.body;
    if (typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: 'Code is required.' });
    }

    // Look up the assignmentId from the question
    const question = await db.get('SELECT assignmentId FROM assignment_questions WHERE id = ?', questionId);
    if (!question) {
        return res.status(404).json({ message: 'Question not found.' });
    }

    const now = new Date().toISOString();

    if (db.isPostgres) {
        // Check if a submission already exists for this question+student
        const existing = await db.get(
            'SELECT id FROM submissions WHERE questionId = ? AND studentId = ?',
            questionId, req.session.studentId
        );

        if (existing) {
            await db.run(
                'UPDATE submissions SET code = ?, stdout = ?, stderr = ?, submittedAt = ? WHERE id = ?',
                code, stdout || '', stderr || '', now, existing.id
            );
        } else {
            await db.run(
                'INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
                question.assignmentId, questionId, req.session.studentId, code, stdout || '', stderr || '', now
            );
        }
    } else {
        // For SQLite, check and upsert manually
        const existing = await db.get(
            'SELECT id FROM submissions WHERE questionId = ? AND studentId = ?',
            questionId, req.session.studentId
        );

        if (existing) {
            await db.run(
                'UPDATE submissions SET code = ?, stdout = ?, stderr = ?, submittedAt = ? WHERE id = ?',
                code, stdout || '', stderr || '', now, existing.id
            );
        } else {
            await db.run(
                'INSERT INTO submissions (assignmentId, questionId, studentId, code, stdout, stderr, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
                question.assignmentId, questionId, req.session.studentId, code, stdout || '', stderr || '', now
            );
        }
    }

    res.json({ message: 'Submitted successfully' });
});

// ── Legacy POST /submissions — keep for backward compat ────────────────────
router.post('/submissions', requireLogin, async (req, res) => {
    const { assignmentId, code, stdout, stderr } = req.body;
    const validAssignmentId = Number(assignmentId);
    if (!Number.isInteger(validAssignmentId) || validAssignmentId <= 0 || typeof code !== 'string' || !code.trim()) {
        return res.status(400).json({ message: 'Assignment ID and code are required.' });
    }

    const now = new Date().toISOString();

    if (db.isPostgres) {
        await db.run(
            `INSERT INTO submissions (assignmentId, studentId, code, stdout, stderr, submittedAt) 
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (assignmentId, studentId) 
       DO UPDATE SET code = EXCLUDED.code, stdout = EXCLUDED.stdout, stderr = EXCLUDED.stderr, submittedAt = EXCLUDED.submittedAt`,
            validAssignmentId, req.session.studentId, code, stdout || '', stderr || '', now
        );
    } else {
        await db.run(
            `INSERT OR REPLACE INTO submissions (assignmentId, studentId, code, stdout, stderr, submittedAt) 
       VALUES (?, ?, ?, ?, ?, ?)`,
            validAssignmentId, req.session.studentId, code, stdout || '', stderr || '', now
        );
    }

    res.json({ message: 'Submitted successfully' });
});

// ── GET /assignments/:id/submissions — grouped by student, per-question ─────
router.get('/assignments/:id/submissions', requireLogin, async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        return res.status(400).json({ message: 'Invalid assignment ID.' });
    }

    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can view submissions.' });
    }

    const assignment = await db.get(
        `SELECT a.id, a.title, a.subject, a.semester, a.createdBy, s.name AS teacherName
         FROM assignments a
         LEFT JOIN students s ON s.studentId = a.createdBy
         WHERE a.id = ?`,
        assignmentId
    );
    if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found.' });
    }

    if (assignment.createdBy !== req.session.studentId) {
        return res.status(403).json({ message: 'You can only view submissions for your own assignments.' });
    }

    // Fetch all submissions with question info, grouped by student
    const submissions = await db.all(
        `SELECT sub.*, 
                st.name AS studentName,
                aq.questionNumber, aq.title AS questionTitle, aq.language AS questionLanguage
         FROM submissions sub
         JOIN students st ON st.studentId = sub.studentId
         LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
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
        grouped[s.studentId].submissions.push({
            id: s.id,
            questionId: s.questionId,
            questionNumber: s.questionNumber || 1,
            questionTitle: s.questionTitle || 'Question',
            questionLanguage: s.questionLanguage,
            code: s.code,
            stdout: s.stdout,
            stderr: s.stderr,
            submittedAt: s.submittedAt
        });
    });

    res.json({
        assignment: {
            id: assignment.id,
            title: assignment.title,
            subject: assignment.subject,
            semester: assignment.semester,
            teacherName: assignment.teacherName
        },
        students: Object.values(grouped)
    });
});

// ── GET /my-submissions — student's own submissions with question info ──────
router.get('/my-submissions', requireLogin, async (req, res) => {
    const submissions = await db.all(`
    SELECT sub.*, a.title AS assignmentTitle, a.subject, a.semester,
           aq.title AS questionTitle, aq.questionNumber, aq.language
    FROM submissions sub
    JOIN assignments a ON a.id = sub.assignmentId
    LEFT JOIN assignment_questions aq ON aq.id = sub.questionId
    WHERE sub.studentId = ?
    ORDER BY sub.submittedAt DESC
  `, req.session.studentId);

    res.json(submissions);
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
                `INSERT INTO submission_events (assignmentId, questionId, studentId, eventType, payload, clientTime, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                resolvedAssignmentId, questionId || null, studentId, eventType, payload, clientTime, now
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
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only teachers can view event logs.' });
        }

        const questionId = Number(req.params.questionId);
        const studentId = req.params.studentId;

        const question = await db.get(
            'SELECT aq.*, a.createdBy FROM assignment_questions aq JOIN assignments a ON a.id = aq.assignmentId WHERE aq.id = ?',
            questionId
        );
        if (!question) {
            return res.status(404).json({ message: 'Question not found.' });
        }
        if (question.createdBy !== req.session.studentId) {
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
        const admin = await isAdmin(req.session.studentId);
        if (!admin) {
            return res.status(403).json({ message: 'Only teachers can view event logs.' });
        }

        const assignmentId = req.params.id;
        const studentId = req.params.studentId;

        const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found.' });
        }
        if (assignment.createdBy !== req.session.studentId) {
            return res.status(403).json({ message: 'You can only view events for your own assignments.' });
        }

        const events = await db.all(
            `SELECT * FROM submission_events WHERE assignmentId = ? AND studentId = ? ORDER BY id ASC`,
            assignmentId, studentId
        );

        res.json(events);
    } catch (err) {
        console.error('[Code Lab] Fetch events error:', err);
        res.status(500).json({ message: 'Failed to load events.' });
    }
});

module.exports = router;
