const express = require('express');
const router = express.Router();
const db = require('../../db');

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

// Create a new assignment (admin only)
router.post('/assignments', requireLogin, async (req, res) => {
    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can create assignments.' });
    }

    const { title, description, language, subject } = req.body;
    if (!title || !description || !language) {
        return res.status(400).json({ message: 'Title, description, and language are required.' });
    }

    const result = await db.run(
        'INSERT INTO assignments (title, description, language, subject, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        title, description, language, subject || null, req.session.studentId, new Date().toISOString()
    );

    res.json({ message: 'Assignment created', id: result.lastInsertRowid });
});

// List ALL assignments (any logged-in user can see all — students need this)
router.get('/assignments', requireLogin, async (req, res) => {
    const assignments = await db.all(`
    SELECT assignments.*, students.name AS teacherName
    FROM assignments
    JOIN students ON students.studentId = assignments.createdBy
    ORDER BY assignments.createdAt DESC
  `);
    res.json(assignments);
});

// List only the logged-in admin's OWN assignments (for managing)
router.get('/my-assignments', requireLogin, async (req, res) => {
    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can view this.' });
    }

    const assignments = await db.all(
        'SELECT * FROM assignments WHERE createdBy = ? ORDER BY createdAt DESC',
        req.session.studentId
    );
    res.json(assignments);
});

// Get a single assignment
router.get('/assignments/:id', requireLogin, async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        return res.status(400).json({ message: 'Invalid assignment ID.' });
    }

    const assignment = await db.get('SELECT * FROM assignments WHERE id = ?', assignmentId);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
    res.json(assignment);
});

// Submit code for an assignment (overwrites previous submission if one exists)
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

// Get all submissions for one assignment (only the assignment's own creator can view)
router.get('/assignments/:id/submissions', requireLogin, async (req, res) => {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
        return res.status(400).json({ message: 'Invalid assignment ID.' });
    }

    const admin = await isAdmin(req.session.studentId);
    if (!admin) {
        return res.status(403).json({ message: 'Only admins can view submissions.' });
    }

    const assignment = await db.get('SELECT createdBy FROM assignments WHERE id = ?', assignmentId);
    if (!assignment) {
        return res.status(404).json({ message: 'Assignment not found.' });
    }

    if (assignment.createdBy !== req.session.studentId) {
        return res.status(403).json({ message: 'You can only view submissions for your own assignments.' });
    }

    const submissions = await db.all(
        `SELECT submissions.*, students.name AS studentName 
     FROM submissions 
     JOIN students ON students.studentId = submissions.studentId
     WHERE assignmentId = ? 
     ORDER BY submittedAt DESC`,
        assignmentId
    );

    res.json(submissions);
});

// Get all of the logged-in student's own submissions (with assignment info)
router.get('/my-submissions', requireLogin, async (req, res) => {
    const submissions = await db.all(`
    SELECT submissions.*, assignments.title, assignments.subject, assignments.language
    FROM submissions
    JOIN assignments ON assignments.id = submissions.assignmentId
    WHERE submissions.studentId = ?
    ORDER BY submissions.submittedAt DESC
  `, req.session.studentId);

    res.json(submissions);
});
// POST /api/code-lab/events — student's browser posts a batch of events
router.post('/events', requireLogin, async (req, res) => {
    try {
        const { assignmentId, events } = req.body;
        const studentId = req.session.studentId;

        if (!assignmentId || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ message: 'assignmentId and a non-empty events array are required.' });
        }

        const safeEvents = events.slice(0, 200);
        const now = new Date().toISOString();

        for (const ev of safeEvents) {
            const eventType = String(ev.type || 'unknown').slice(0, 40);
            let payload = '';
            try {
                payload = JSON.stringify(ev.payload || {}).slice(0, 2000);
            } catch (e) {
                payload = '';
            }
            const clientTime = ev.clientTime ? String(ev.clientTime).slice(0, 40) : null;

            await db.run(
                `INSERT INTO submission_events (assignmentId, studentId, eventType, payload, clientTime, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
                assignmentId, studentId, eventType, payload, clientTime, now
            );
        }

        res.json({ success: true, stored: safeEvents.length });
    } catch (err) {
        console.error('[Code Lab] Event logging error:', err);
        res.status(500).json({ message: 'Failed to store events.' });
    }
});
// GET /api/code-lab/assignments/:id/events/:studentId — teacher views one student's event log
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
