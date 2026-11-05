'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    formatToolResult,
    parseAttendanceBlock,
    parseKyanaVisualBlock,
    VISUAL_BLOCK_KINDS
} = require('../lib/chat-tools');
const {
    stabilizeStreamingMarkdown,
    fallbackMarkdown,
    renderKyanaVisualBlockHtml
} = require('../public/chatbot.js');

const chatbotJsPath = path.join(__dirname, '..', 'public', 'chatbot.js');
const chatbotCssPath = path.join(__dirname, '..', 'public', 'chatbot.css');
const postMarkdownPath = path.join(__dirname, '..', 'mobile', 'components', 'PostMarkdown.tsx');
const kyanaMobilePath = path.join(__dirname, '..', 'mobile', 'app', 'kyana.tsx');

const chatbotJsSource = fs.readFileSync(chatbotJsPath, 'utf8');
const chatbotCssSource = fs.readFileSync(chatbotCssPath, 'utf8');
const postMarkdownSource = fs.readFileSync(postMarkdownPath, 'utf8');
const kyanaMobileSource = fs.readFileSync(kyanaMobilePath, 'utf8');

function extractVisualBlockFromReply(reply, kind) {
    const regex = new RegExp('```' + kind + '\\n([\\s\\S]*?)```', 'i');
    const match = String(reply || '').match(regex);
    return match ? match[1].trim() : null;
}

// ============================================================================
// 1. Attendance (100%, 50%, 49%, 0% with records, 0 recorded classes, no eligibility)
// ============================================================================
test('Scenario 1: Attendance visual block, threshold colors, and zero eligibility references', () => {
    const raw = {
        semesterNo: 3,
        overall: {
            attendancePercentage: 48,
            presentCount: 12,
            absentCount: 13,
            totalSessions: 25
        },
        subjects: [
            { code: 'CIT214', name: 'Data Structure and Algorithms', attendancePercentage: 100, presentCount: 5, absentCount: 0, totalSessions: 5 },
            { code: 'CIT211', name: 'Computer Architecture', attendancePercentage: 50, presentCount: 5, absentCount: 5, totalSessions: 10 },
            { code: 'CIT212', name: 'System Analysis and Design', attendancePercentage: 20, presentCount: 2, absentCount: 8, totalSessions: 10 },
            { code: 'CIT213', name: 'Database Management System', attendancePercentage: null, presentCount: 0, absentCount: 0, totalSessions: 0 }
        ]
    };

    const formatted = formatToolResult('get_my_attendance', raw);
    assert.ok(formatted.includes('```attendance'), 'Expected ```attendance visual block');
    assert.ok(!/eligib/i.test(formatted), 'Must NEVER mention examination eligibility');

    const blockText = extractVisualBlockFromReply(formatted, 'attendance');
    assert.ok(blockText, 'Expected inner attendance block content');

    const parsed = parseKyanaVisualBlock('attendance', blockText);
    assert.equal(parsed.kind, 'attendance');
    assert.equal(parsed.overallPct, 48);
    assert.equal(parsed.isLow, true);
    assert.equal(parsed.recordedItems.length, 3);
    assert.equal(parsed.unrecordedItems.length, 1);
    assert.equal(parsed.unrecordedItems[0].code, 'CIT213');

    // Render Web HTML
    const html = renderKyanaVisualBlockHtml('attendance', blockText);
    assert.ok(html.includes('kyana-attendance-card'), 'Expected monochromatic card container');
    assert.ok(html.includes('Low Attendance'), 'Expected Low Attendance badge for <50%');
    assert.ok(html.includes('No records'), 'Expected No records label for 0 total classes');
    assert.ok(!/eligib/i.test(html), 'Web HTML must never include eligibility language');
});

// ============================================================================
// 2. Academic marks and results
// ============================================================================
test('Scenario 2: Academic marks and results visual block, subject bars, Absent/<40% warning, and unpublished handling', () => {
    const rawPublished = {
        hasPublishedResults: true,
        currentSemesterNo: 3,
        overallAggregate: {
            totalObtained: 117,
            totalMax: 200,
            percentage: 58.5,
            formattedPercentage: '58.5%'
        },
        allResults: [
            {
                subjectCode: 'CIT214',
                subjectName: 'Data Structure and Algorithms',
                examType: 'Mid-Term',
                semesterNo: 3,
                obtainedMarks: 85,
                maxMarks: 100,
                percentage: 85,
                formattedPercentage: '85%',
                isAbsent: false
            },
            {
                subjectCode: 'CIT211',
                subjectName: 'Computer Architecture',
                examType: 'Mid-Term',
                semesterNo: 3,
                obtainedMarks: 32,
                maxMarks: 100,
                percentage: 32,
                formattedPercentage: '32%',
                isAbsent: false
            },
            {
                subjectCode: 'CIT212',
                subjectName: 'Database Management System',
                examType: 'Mid-Term',
                semesterNo: 3,
                obtainedMarks: 0,
                maxMarks: 100,
                percentage: 0,
                formattedPercentage: '0%',
                isAbsent: true
            }
        ]
    };

    const formatted = formatToolResult('get_my_results', rawPublished);
    assert.ok(formatted.includes('```results'), 'Expected ```results visual block');

    const blockText = extractVisualBlockFromReply(formatted, 'results');
    assert.ok(blockText, 'Expected inner results block content');

    const parsed = parseKyanaVisualBlock('results', blockText);
    assert.equal(parsed.kind, 'results');
    assert.equal(parsed.items.length, 3);

    const lowSubj = parsed.items.find((s) => s.code === 'CIT211');
    assert.equal(lowSubj.pct, 32);
    assert.equal(lowSubj.isLow, true);

    const absentSubj = parsed.items.find((s) => s.code === 'CIT212');
    assert.equal(absentSubj.isAbsent, true);
    assert.equal(absentSubj.isLow, true);

    const html = renderKyanaVisualBlockHtml('results', blockText);
    assert.ok(html.includes('kyana-results-card'), 'Expected kyana-results-card class');
    assert.ok(html.includes('Absent'), 'Expected Absent red badge');
    assert.ok(html.includes('is-low'), 'Expected red warning class for <40% or Absent');

    // Unpublished / no_results check — must not fabricate GPA or marks
    const unpublishedFormatted = formatToolResult('get_my_results', {
        hasPublishedResults: false,
        allResults: [],
        requestedSemester: 3
    });
    assert.ok(!unpublishedFormatted.includes('```results'));
    assert.match(unpublishedFormatted, /No published exam results were found/i);
});

// ============================================================================
// 3. Assignments
// ============================================================================
test('Scenario 3: Assignments visual block with overdue priority indicator, submission status, and grades', () => {
    const rawAssignments = {
        assignments: [
            {
                id: 501,
                title: 'B+ Tree Indexing Implementation',
                subject: 'Database Management System',
                semester: 3,
                authorName: 'Prof. Sharma',
                deadline: '2020-01-15',
                isMissed: true,
                description: 'Implement insertion and search in C++.',
                studentSubmission: {
                    submitted: false,
                    checked: false
                }
            },
            {
                id: 502,
                title: 'AVL Tree Balancing Lab',
                subject: 'Data Structure and Algorithms',
                semester: 3,
                authorName: 'Er. Adhikari',
                deadline: '2099-12-30',
                isMissed: false,
                description: 'Submit source code and complexity analysis.',
                studentSubmission: {
                    submitted: true,
                    checked: true,
                    hasReleasedGrades: true,
                    obtainedScore: 18,
                    totalPossibleScore: 20
                }
            }
        ]
    };

    const formatted = formatToolResult('search_assignments', rawAssignments);
    assert.ok(formatted.includes('```assignments'), 'Expected ```assignments visual block');

    const blockText = extractVisualBlockFromReply(formatted, 'assignments');
    const parsed = parseKyanaVisualBlock('assignments', blockText);
    assert.equal(parsed.kind, 'assignments');
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.items[0].isOverdue, true, 'Past unsubmitted assignment must be marked overdue');
    assert.equal(parsed.items[1].isOverdue, false, 'Submitted/checked assignment must not be overdue');

    const html = renderKyanaVisualBlockHtml('assignments', blockText);
    assert.ok(html.includes('kyana-assignments-card'));
    assert.ok(html.includes('kyana-att-low-badge'), 'Expected red Overdue badge');
    assert.ok(html.includes('Prof. Sharma'), 'Expected teacher metadata');
});

// ============================================================================
// 4. Library notes and files
// ============================================================================
test('Scenario 4: Library notes and files visual block with subject, semester, chapter, folder path, and PDF pill', () => {
    const rawNotes = {
        files: [
            {
                title: 'Unit 3 — Normalization and Functional Dependencies.pdf',
                subject: 'Database Management System',
                semester: 3,
                chapter: 3,
                folderPath: 'Semester 3 / DBMS / Unit 3'
            }
        ]
    };

    const formatted = formatToolResult('search_notes', rawNotes);
    assert.ok(formatted.includes('```notes'), 'Expected ```notes visual block');

    const blockText = extractVisualBlockFromReply(formatted, 'notes');
    const parsed = parseKyanaVisualBlock('notes', blockText);
    assert.equal(parsed.kind, 'notes');
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].subject, 'Database Management System');
    assert.equal(parsed.items[0].semester, 'Semester 3');
    assert.equal(parsed.items[0].fileType, 'PDF');
    assert.equal(parsed.items[0].chapter, 'Chapter 3');

    const html = renderKyanaVisualBlockHtml('notes', blockText);
    assert.ok(html.includes('kyana-notes-card'));
    assert.ok(html.includes('PDF'), 'Expected PDF file-type pill');
    assert.ok(html.includes('Semester 3'), 'Expected semester label');
});

// ============================================================================
// 5. Official notices
// ============================================================================
test('Scenario 5: Official notices formatting, authority badges, conflict warning, and visual block rendering', () => {
    const rawNotices = {
        query: 'Show me the notices',
        viewerSemester: 3,
        evidenceValidation: {
            hasConflicts: true,
            conflicts: [
                {
                    reason: 'contradictory_dates',
                    firstTitle: 'Exam Notice A',
                    secondTitle: 'Exam Notice B',
                    firstDates: ['Chaitra 20'],
                    secondDates: ['Chaitra 25']
                }
            ],
            hasOutdatedOnly: false
        },
        notices: [
            {
                id: 1,
                title: 'Mid-Term Exam Routine Published',
                category: 'Exam Notice',
                publishedDate: '2026-03-28',
                authorRole: 'admin',
                authorityTier: 1,
                content: 'Mid-term examinations for Semester 3 start from Chaitra 22.'
            }
        ]
    };

    const formatted = formatToolResult('search_notices', rawNotices);
    assert.ok(formatted.includes('Conflicting Announcements Detected'), 'Expected conflict warning');
    assert.ok(formatted.includes('Mid-Term Exam Routine Published'), 'Expected notice title');

    // Also verify the visual block parser & renderer for ```notices
    const sampleNoticeBlock = [
        '- **Mid-Term Exam Routine Published** [Official Notice] (2026-03-28): Mid-term examinations for Semester 3 start from Chaitra 22.',
        '- **Study Group for DBMS** [Community Post] (By Ramesh Thapa): Revising normalization together.'
    ].join('\n');
    const parsed = parseKyanaVisualBlock('notices', sampleNoticeBlock);
    assert.equal(parsed.kind, 'notices');
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.items[0].isOfficial, true);
    assert.equal(parsed.items[1].isOfficial, false);

    const html = renderKyanaVisualBlockHtml('notices', sampleNoticeBlock);
    assert.ok(html.includes('Official Notice'));
    assert.ok(html.includes('Mid-Term Exam Routine Published'));
});

// ============================================================================
// 6. Routine and schedules
// ============================================================================
test('Scenario 6: Class routine and schedules visual block with day/date, subject, time, and room badge', () => {
    const rawRoutine = {
        semester: 3,
        routine: [
            {
                subject: 'Data Structure and Algorithms (CIT214)',
                date: '2082 Chaitra 17',
                calendar: 'BS',
                day: 'Monday',
                time: '07:00 AM - 08:30 AM',
                room: 'Lab 2'
            }
        ]
    };

    const formatted = formatToolResult('get_routine', rawRoutine);
    assert.ok(formatted.includes('```routine'), 'Expected ```routine visual block');
    assert.ok(formatted.includes('Data Structure and Algorithms (CIT214)'));

    const blockText = extractVisualBlockFromReply(formatted, 'routine');
    const parsed = parseKyanaVisualBlock('routine', blockText);
    assert.equal(parsed.kind, 'routine');
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].day, 'Monday');
    assert.equal(parsed.items[0].room, 'Lab 2');
    assert.ok(parsed.items[0].time.includes('07:00 AM'));

    const html = renderKyanaVisualBlockHtml('routine', blockText);
    assert.ok(html.includes('kyana-routine-card'));
    assert.ok(html.includes('Room Lab 2'));
    assert.ok(html.includes('07:00 AM - 08:30 AM'));
});

// ============================================================================
// 7. General posts and structured directory responses
// ============================================================================
test('Scenario 7: General posts and directory visual blocks preserve author, role, and structured metadata', () => {
    const rawPosts = {
        posts: [
            {
                title: 'Past Question Solutions',
                authorName: 'Sita Gurung',
                category: 'Discussion',
                createdAt: '2026-03-29',
                content: 'Can someone share the past question solutions for Computer Architecture?'
            }
        ]
    };
    const formattedPosts = formatToolResult('search_posts', rawPosts);
    assert.ok(formattedPosts.includes('Sita Gurung'));
    assert.ok(formattedPosts.includes('Past Question Solutions'));

    const postsBlock = '- **Past Question Solutions** (Sita Gurung · Discussion): Can someone share the past question solutions for Computer Architecture?';
    const parsedPosts = parseKyanaVisualBlock('posts', postsBlock);
    assert.equal(parsedPosts.kind, 'posts');
    assert.equal(parsedPosts.items.length, 1);
    assert.equal(parsedPosts.items[0].title, 'Past Question Solutions');

    const postsHtml = renderKyanaVisualBlockHtml('posts', postsBlock);
    assert.ok(postsHtml.includes('Sita Gurung'));
    assert.ok(postsHtml.includes('kyana-posts-card'));

    const dirBlock = '- **Er. Adhikari** (CIT214) — Data Structure and Algorithms · Senior Lecturer';
    const parsedDir = parseKyanaVisualBlock('directory', dirBlock);
    assert.equal(parsedDir.kind, 'directory');
    assert.equal(parsedDir.items.length, 1);
    const dirHtml = renderKyanaVisualBlockHtml('directory', dirBlock);
    assert.ok(dirHtml.includes('Er. Adhikari'));
});

// ============================================================================
// 8. Ordinary conversational answers (NOT turned into cards)
// ============================================================================
test('Scenario 8: Ordinary conversational answers render as clean Markdown prose/tables without card wrappers', () => {
    const tcpUdpAnswer = [
        '### Key Differences Between TCP and UDP',
        '',
        'TCP is a connection-oriented protocol, whereas UDP is connectionless.',
        '',
        '| Feature | TCP | UDP |',
        '| --- | --- | --- |',
        '| Connection | Requires handshake | No handshake |',
        '| Reliability | Guaranteed delivery | Best-effort |',
        '',
        '- Use **TCP** for web browsing, email, and file transfers.',
        '- Use **UDP** for live video streaming and DNS lookups.'
    ].join('\n');

    const html = fallbackMarkdown(tcpUdpAnswer);
    assert.ok(!html.includes('kyana-attendance-card'), 'Ordinary explanation must NOT be wrapped in a visual card');
    assert.ok(html.includes('<h3>'), 'Expected clean heading hierarchy');
    assert.ok(html.includes('<table'), 'Expected standard Markdown comparison table');
    assert.ok(html.includes('<ul>'), 'Expected clean bulleted list');
});

// ============================================================================
// 9. Tables, nested lists, code, and mathematics
// ============================================================================
test('Scenario 9: Code blocks, math expressions, and tables preserve accuracy across Web and Mobile', () => {
    // Check Web inline math protection in public/chatbot.js
    const renderedMathHtml = fallbackMarkdown('The recurrence is $T(n) = a_1 n_1 + a_2 n_2$ for all $n \\ge 1$.');
    assert.ok(
        !renderedMathHtml.includes('<em>'),
        'Web Markdown renderer must protect inline $...$ math so underscores are not parsed as italics'
    );
    assert.ok(
        chatbotJsSource.includes('@@KYANA_MATH_BLOCK_'),
        'Web renderMarkdownContent must protect inline $...$ math before marked.parse'
    );

    // Check Mobile nested math formatting in PostMarkdown.tsx
    assert.ok(
        postMarkdownSource.includes('function formatMathExpression'),
        'Mobile PostMarkdown.tsx must define inside-out formatMathExpression for nested fractions, roots, and matrices'
    );
    assert.ok(
        postMarkdownSource.includes('\\\\begin\\{(?:p|b|v|V)?matrix\\}'),
        'Mobile formatMathExpression must support LaTeX matrix environments'
    );

    // Check code copy fidelity in Web & Mobile
    assert.ok(
        chatbotJsSource.includes('navigator.clipboard.writeText(codeToCopy)'),
        'Web code copy button must copy raw codeToCopy byte-for-byte'
    );
    assert.ok(
        postMarkdownSource.includes('Clipboard.setStringAsync(rawCode)'),
        'Mobile code copy button must copy rawCode byte-for-byte'
    );
});

// ============================================================================
// 10. Streaming and partial responses
// ============================================================================
test('Scenario 10: Streaming partial visual blocks and Markdown stabilize cleanly without layout errors', () => {
    const fullReply = formatToolResult('get_my_results', {
        hasPublishedResults: true,
        currentSemesterNo: 3,
        overallAggregate: {
            totalObtained: 160,
            totalMax: 200,
            percentage: 80,
            formattedPercentage: '80%'
        },
        allResults: [
            {
                subjectCode: 'CIT214',
                subjectName: 'DSA',
                examType: 'Final',
                semesterNo: 3,
                obtainedMarks: 80,
                maxMarks: 100,
                percentage: 80,
                formattedPercentage: '80%',
                isAbsent: false
            }
        ]
    });

    for (let len = 15; len <= fullReply.length; len += 25) {
        const chunk = fullReply.slice(0, len);
        const stabilized = stabilizeStreamingMarkdown(chunk);
        assert.equal(typeof stabilized, 'string');
        const fenceCount = (stabilized.match(/```/g) || []).length;
        assert.equal(fenceCount % 2, 0, `Expected balanced code fences at chunk length ${len}`);

        const partialBlock = extractVisualBlockFromReply(stabilized, 'results');
        if (partialBlock !== null) {
            const html = renderKyanaVisualBlockHtml('results', partialBlock);
            assert.equal(typeof html, 'string');
        }
    }
});

// ============================================================================
// 11. Web and Mobile rendering parity
// ============================================================================
test('Scenario 11: Web and Mobile share all 8 VISUAL_BLOCK_KINDS, monochromatic tokens, and streaming memoization', () => {
    for (const kind of VISUAL_BLOCK_KINDS) {
        assert.ok(chatbotJsSource.includes(`'${kind}'`), `Web chatbot.js must register visual block kind '${kind}'`);
        assert.ok(postMarkdownSource.includes(`'${kind.toUpperCase()}'`), `Mobile PostMarkdown.tsx must register visual block kind '${kind.toUpperCase()}'`);
    }

    assert.ok(chatbotCssSource.includes('.kyana-attendance-card'), 'Web CSS must include shared monochromatic card styling');
    assert.ok(chatbotCssSource.includes('#ef4444'), 'Web CSS must use #ef4444 strictly for warning states');
    assert.ok(postMarkdownSource.includes('renderKyanaVisualCard'), 'Mobile PostMarkdown.tsx must define renderKyanaVisualCard');
    assert.ok(kyanaMobileSource.includes('streamingTextRef'), 'Mobile kyana.tsx must use streamingTextRef so FlatList renderItem is not recreated on every streaming token');
});

// ============================================================================
// 12. Missing data, malformed tool results, and link security
// ============================================================================
test('Scenario 12: Missing data, malformed blocks, and protocol-relative URLs are handled safely without crashes', () => {
    for (const kind of VISUAL_BLOCK_KINDS) {
        if (kind === 'attendance') continue;
        const emptyParsed = parseKyanaVisualBlock(kind, '');
        assert.equal(emptyParsed.items.length, 0, `Empty block for ${kind} must have 0 items`);
        const unparseable = parseKyanaVisualBlock(kind, 'random unparseable text without bullets');
        assert.equal(unparseable.items.length, 0, `Unparseable block for ${kind} must have 0 items`);
        assert.equal(renderKyanaVisualBlockHtml(kind, ''), '', `Empty HTML render for ${kind} must return empty string`);
    }

    const emptyAtt = parseAttendanceBlock('');
    assert.equal(emptyAtt.hasOverview, false);
    assert.equal(emptyAtt.recordedItems.length, 0);
    assert.equal(formatToolResult('get_my_results', { error: 'Database timeout' }), 'Database timeout');

    // Verify protocol-relative URLs (//evil.com) are rejected on both Web and Mobile
    assert.ok(
        chatbotJsSource.includes("trimmed.startsWith('//')"),
        'Web safeLink must reject protocol-relative //evil.com links'
    );
    assert.ok(
        postMarkdownSource.includes("/^\\/(?!\\/)/") || postMarkdownSource.includes("startsWith('//')"),
        'Mobile openSafeUrl must reject protocol-relative //evil.com links'
    );
});
