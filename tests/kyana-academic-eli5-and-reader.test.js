'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { handleChat } = require('../ai-assistant');
const {
  formatToolResult,
  createTools,
  routeQuery,
  classifyUserIntent
} = require('../lib/chat-tools');
const {
  classifyAcademicQuestion,
  buildAcademicTutorPrompt
} = require('../lib/academic-intelligence');

// ============================================================================
// 1. "Teach Like We're 5" & No Robotic Citation / Link Preamble
// ============================================================================

test('Pedagogy: Academic tutor prompt instructs 5-stage intuitive structure without robotic citations', () => {
  const classification = classifyAcademicQuestion('what is session and cookies management');
  const tutorPrompt = buildAcademicTutorPrompt('what is session and cookies management', classification);

  // 1. Must NOT instruct robotic citations
  assert.ok(!tutorPrompt.includes('This is extracted from **[File Title]**'));
  assert.match(tutorPrompt, /NO ROBOTIC CITATIONS/i);
  assert.match(tutorPrompt, /NO UNSOLICITED FILE\/SYLLABUS LINKS/i);

  // 2. Must instruct ELI5 / 5-stage intuitive structure
  assert.match(tutorPrompt, /First, understand the problem/i);
  assert.match(tutorPrompt, /Core Concept & Plain-Language Definitions/i);
  assert.match(tutorPrompt, /Systematic Visual Flow Diagram & Comparison Table/i);
  assert.match(tutorPrompt, /Practical Code Example \/ Real-World Implementation/i);
  assert.match(tutorPrompt, /Pro Tips \/ Best Practices/i);
});

test('Attribution: Academic concept explanation omits "This is extracted from" and unsolicited links', async () => {
  const query = 'what is session and cookies management';
  let capturedSystemPrompt = '';

  const mockNoteEvidence = [
    {
      id: 99,
      title: 'BIT_CURRICULUM (1).pdf',
      subject: 'General',
      chapter: 'Programming in PHP and MYSQL',
      folderPath: 'General / Programming in PHP and MYSQL',
      pageNumbers: [36],
      extractedContent: 'Cookies and sessions are mechanisms used to maintain state in web applications...'
    }
  ];

  const result = await handleChat(
    null,
    query,
    { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
    [],
    'sess-eli5-test',
    {
      academicContext: { studentId: 'stu_1', semester: 2, role: 'student', authenticated: true },
      generateReply: async ({ systemPrompt, onDelta }) => {
        capturedSystemPrompt = systemPrompt;
        assert.ok(!systemPrompt.includes('State explicit attribution at the beginning: "This is extracted from'));

        const reply = [
          '### 1. First, understand the problem',
          'HTTP is a **stateless** protocol. This means the web server doesn\'t automatically remember who you are from one request to the next.',
          '',
          'Imagine this: You open **Semester Library** and log in. You check your routine, then your notes, then your chat.',
          'Without state management, the server would treat every click as an anonymous stranger and ask you to log in again every time!',
          '',
          '### 2. Cookies vs. Sessions (ELI5)',
          '- **Cookies (Client-Side):** A small token or badge kept in your browser. Like a stamp on your hand at an event.',
          '- **Sessions (Server-Side):** A private locker inside the university server. The server keeps your data safe and only hands your browser a locker key (`session_id`).',
          '',
          '```diagram',
          '+--------------------+                 +----------------------+',
          '| Browser / Client   |                 | Web Server           |',
          '+--------------------+                 +----------------------+',
          '| 1. POST /login     | --------------> | Verifies credentials |',
          '|                    | <-------------- | Set-Cookie: sess_123 |',
          '| 2. GET /profile    | --------------> | Looks up sess_123    |',
          '+--------------------+                 +----------------------+',
          '```',
          '',
          '### Key Differences',
          '| Feature | Cookies | Sessions |',
          '| :--- | :--- | :--- |',
          '| **Storage** | User Browser (Client) | Server Memory / Database |',
          '| **Security** | Lower (can be inspected/tampered) | High (data never leaves server) |',
          '| **Capacity** | Limited (~4KB per cookie) | Large (limited only by server) |',
          '| **Ideal For** | Theme preferences, "Remember me" | Authentication, carts, sensitive data |',
          '',
          '### 3. Practical PHP Example',
          '```php',
          '// Starting a session and storing user state',
          'session_start();',
          '$_SESSION["student_id"] = "stu_123";',
          '',
          '// Setting a secure, tamper-resistant cookie',
          'setcookie("pref_theme", "dark", time() + (86400 * 30), "/", "", true, true);',
          '```',
          '',
          '### 4. Pro Tips & Security Best Practices',
          '- **HttpOnly Flag:** Always set `HttpOnly` on session cookies so malicious JavaScript cannot steal them via XSS.',
          '- **Secure Flag:** Always set `Secure` so cookies travel only over encrypted HTTPS.',
          '- **Session Regeneration:** Run `session_regenerate_id(true)` immediately upon login to prevent session fixation attacks.'
        ].join('\n');

        onDelta(reply);
        return { reply };
      }
    }
  );

  assert.ok(!result.reply.includes('This is extracted from **BIT_CURRICULUM'));
  assert.ok(!result.reply.includes('This is extracted from'));
  assert.ok(!result.reply.includes('[Full syllabus]'));
  assert.match(result.reply, /First, understand the problem/i);
  assert.match(result.reply, /stateless/i);
  assert.match(result.reply, /Cookies vs\. Sessions/i);
  assert.match(result.reply, /Key Differences/i);
  assert.match(result.reply, /Pro Tips/i);
  assert.equal(result.resourceCards.length, 0, 'Must not return unsolicited resourceCards for academic concept explanations');
});

test('Visuals: buildDeterministicVisualEnrichment provides interactive lifecycle diagram for sessions and cookies', () => {
  const { buildDeterministicVisualEnrichment } = require('../lib/academic-intelligence');
  const classification = classifyAcademicQuestion('what is session and cookies management');
  const enrichment = buildDeterministicVisualEnrichment('what is session and cookies management', classification);

  assert.ok(enrichment.includes('```diagram'), 'Must include diagram block');
  assert.ok(enrichment.includes('Session & Cookie Lifecycle'), 'Must have descriptive title');
  assert.ok(enrichment.includes('Browser submits credentials'));
  assert.ok(enrichment.includes('Server validates SID'));
});

test('Links: formatToolResult omits [Full syllabus] when user does not ask for links', () => {
  const dsaRoute = routeQuery('What should I study in Server-Side Scripting?');
  const toolkit = createTools(null, dsaRoute);

  const { courses } = require('../lib/chat-tools');
  const cit123 = courses.find(c => c.code === 'CIT123');

  const res = {
    courses: [cit123],
    requestedUnit: 5,
    query: 'What should I study in Server-Side Scripting?'
  };

  const formattedWithoutLink = formatToolResult('get_syllabus', res);
  assert.ok(!formattedWithoutLink.includes('[Full syllabus]'), 'Should not include [Full syllabus] when user did not ask for links');

  const resWithLinkRequest = {
    courses: [cit123],
    requestedUnit: 5,
    query: 'Give me the syllabus link for Web Technology'
  };
  const formattedWithLink = formatToolResult('get_syllabus', resWithLinkRequest);
  assert.ok(formattedWithLink.includes('[Full syllabus]'), 'Should include [Full syllabus] when user asks for link');
});

// ============================================================================
// 2. Full-Screen Reader Modal & Double-Tap Layout Verification
// ============================================================================

test('Full Screen Reader Modal: public/chatbot.js includes KyanaReaderModal and double-tap listeners', () => {
  const chatbotJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.js'), 'utf8');

  // 1. Verify KyanaReaderModal component
  assert.ok(chatbotJs.includes('const KyanaReaderModal = {'), 'Must include KyanaReaderModal component');
  assert.ok(chatbotJs.includes('kyana-reader-overlay'), 'Must include kyana-reader-overlay element');
  assert.ok(chatbotJs.includes('Academic Focus View'), 'Must include Academic Focus View badge');
  assert.ok(chatbotJs.includes('kyana-reader-zoom-controls'), 'Must include zoom controls (A- / A+)');
  assert.ok(chatbotJs.includes('kyana-reader-copy-btn'), 'Must include reader modal copy button');
  assert.ok(chatbotJs.includes('kyana-reader-close-btn'), 'Must include reader modal close button');

  // 2. Verify Double-tap & Double-click triggers on KyanaResponse
  assert.ok(chatbotJs.includes("row.setAttribute('data-kyana-expandable', 'true')"));
  assert.ok(chatbotJs.includes("row.addEventListener('dblclick'"));
  assert.ok(chatbotJs.includes("row.addEventListener('touchend'"));
  assert.ok(chatbotJs.includes("KyanaReaderModal.open(doc)"));

  // 3. Verify Expand button in KyanaResponseActions
  assert.ok(chatbotJs.includes('kyana-fullscreen-btn'), 'Must include Expand button in action bar');
});

test('Styling: public/chatbot.css includes reader modal animations, table scrolling, and diagram arrangement', () => {
  const chatbotCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.css'), 'utf8');

  // 1. Modal overlay and smooth animation
  assert.ok(chatbotCss.includes('.kyana-reader-overlay'));
  assert.ok(chatbotCss.includes('.kyana-reader-backdrop'));
  assert.ok(chatbotCss.includes('.kyana-reader-window'));
  assert.ok(chatbotCss.includes('backdrop-filter: blur'));
  assert.ok(chatbotCss.includes('transform: scale(0.94) translateY(12px)'));
  assert.ok(chatbotCss.includes('transform: scale(1) translateY(0)'));

  // 2. Table arrangement in chat stream and modal
  assert.ok(chatbotCss.includes('.kyana-table-wrapper'));
  assert.ok(chatbotCss.includes('overflow-x: auto'));
  assert.ok(chatbotCss.includes('.kyana-table th'));
  assert.ok(chatbotCss.includes('.kyana-table td'));
  assert.ok(chatbotCss.includes('.kyana-reader-body .kyana-table'));

  // 3. Diagram preformatting
  assert.ok(chatbotCss.includes('.kyana-diagram-pre'));
  assert.ok(chatbotCss.includes('white-space: pre'));
});

test('Mobile Reader & Code Layout: mobile/app/kyana.tsx and PostMarkdown.tsx support double-tap, full-screen reader modal, and clean code alignment', () => {
  const kyanaTsx = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app', 'kyana.tsx'), 'utf8');
  const postMarkdownTsx = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'components', 'PostMarkdown.tsx'), 'utf8');

  // 1. Mobile kyana.tsx has readerMessage state, double tap handler, and reader modal
  assert.ok(kyanaTsx.includes('const [readerMessage, setReaderMessage] = useState<KyanaMessage | null>(null);'));
  assert.ok(kyanaTsx.includes('lastBubbleTapRef.current[item.id]'));
  assert.ok(kyanaTsx.includes('now - last < 350'));
  assert.ok(kyanaTsx.includes('name="expand-outline"'));
  assert.ok(kyanaTsx.includes('KYANA STUDY READER'));
  assert.ok(kyanaTsx.includes('readerScrollView'));
  assert.ok(kyanaTsx.includes('readerCloseBtn'));

  // 2. Mobile PostMarkdown has horizontal scroll indicators, table alignment, and wrapping code
  assert.ok(postMarkdownTsx.includes('showsHorizontalScrollIndicator={true}'));
  assert.ok(postMarkdownTsx.includes('paddingRight: 24'));
  assert.ok(postMarkdownTsx.includes('maxWidth: 220'));
  assert.ok(postMarkdownTsx.includes('colWidths = headerCells.map'));
  assert.ok(postMarkdownTsx.includes('{ width: colWidths[colIdx] }'));
  assert.ok(postMarkdownTsx.includes('codeContentWrapper'));
  assert.ok(postMarkdownTsx.includes('isAsciiFigure'));
});

test('Professionalism & Design: replies omit casual emojis, wrap code lines, and format figures in CSS', () => {
  const { buildAcademicTutorPrompt, buildDeterministicVisualEnrichment } = require('../lib/academic-intelligence');
  const chatbotCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.css'), 'utf8');
  const chatbotJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'chatbot.js'), 'utf8');

  // 1. Directives enforce professional tone and prohibit casual emojis
  const prompt = buildAcademicTutorPrompt('what is session and cookies management', { category: 'concept_explanation' });
  assert.ok(prompt.includes('PROFESSIONAL TONE WITHOUT EMOJIS'));
  assert.ok(prompt.includes('NO RAW ASCII / TEXT ART FIGURES'));
  assert.ok(prompt.includes('CODE FORMATTING & WRAPPING'));

  // 2. Visual lifecycle block has 0 decorative emojis
  const visualBlock = buildDeterministicVisualEnrichment('what is session and cookies management', { category: 'concept_explanation' });
  assert.ok(!/[🍪🔐🌐🖥️⚡📦🔄]/.test(visualBlock), 'Visual block should not contain decorative emojis');
  assert.ok(visualBlock.includes('Client vs Server: Session & Cookie Lifecycle'));

  // 3. CSS wraps code lines when they exceed container width
  assert.ok(chatbotCss.includes('white-space: pre-wrap !important'));
  assert.ok(chatbotCss.includes('.kyana-diagram-node-box'));

  // 4. Web chatbot.js intercepts ASCII figures and converts them into CSS diagram nodes
  assert.ok(chatbotJs.includes('isAsciiFigure'));
});
