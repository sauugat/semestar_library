const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  classifyResponseComplexity,
  styleLookupReply,
  toneInstructions,
} = require('../lib/chat-personality');
const {
  formatToolResult,
  formatEligibilityLabel,
  buildAttendanceProgressBar,
} = require('../lib/chat-tools');
const {
  stabilizeStreamingMarkdown,
  fallbackMarkdown,
  highlightChatCode,
} = require('../public/chatbot.js');

const postMarkdownSource = fs.readFileSync(
  path.join(__dirname, '../mobile/components/PostMarkdown.tsx'),
  'utf8'
);
const kyanaMobileSource = fs.readFileSync(
  path.join(__dirname, '../mobile/app/kyana.tsx'),
  'utf8'
);
const chatbotCssSource = fs.readFileSync(
  path.join(__dirname, '../public/chatbot.css'),
  'utf8'
);

test('1. Short conversational answers: direct, natural, no unnecessary headings or tables', () => {
  const complexity = classifyResponseComplexity('When is the exam?');
  assert.equal(complexity.level, 'simple');
  assert.match(complexity.directive, /SIMPLE QUESTION/i);

  const instructions = toneInstructions('When is the exam?', [], 'roast');
  assert.match(instructions, /RESPONSE COMPLEXITY \(SIMPLE QUESTION\)/i);

  const styled = styleLookupReply(
    '### Direct Answer\n\nNo official holiday notice has been posted for tomorrow. Regular classes follow the Semester 3 routine.',
    'Bholi college bida ho?',
    { hasData: true }
  );
  assert.ok(!/^#{1,3}\s*Direct Answer/im.test(styled), 'Should strip boilerplate Direct Answer heading');
  assert.match(styled, /No official holiday notice has been posted for tomorrow/i);
});

test('2. Long educational explanations: structured headings, paragraphs, and bullet lists render cleanly', () => {
  const complexity = classifyResponseComplexity(
    'Explain normalization in DBMS step by step with 1NF, 2NF, and 3NF examples'
  );
  assert.equal(complexity.level, 'complex');
  assert.match(complexity.directive, /COMPLEX QUESTION/i);

  const markdown = [
    '## Database Normalization',
    '',
    'Normalization organizes relational tables to reduce redundancy and prevent update anomalies.',
    '',
    '### Core Normal Forms',
    '- **1NF (First Normal Form):** Every column holds atomic values and rows are uniquely identified.',
    '- **2NF (Second Normal Form):** Meets 1NF and removes partial dependencies on composite keys.',
    '- **3NF (Third Normal Form):** Meets 2NF and removes transitive dependencies between non-key attributes.',
  ].join('\n');

  const html = fallbackMarkdown(markdown);
  assert.match(html, /<h2>Database Normalization<\/h2>/);
  assert.match(html, /<h3>Core Normal Forms<\/h3>/);
  assert.match(html, /<ul>[\s\S]*<li><strong>1NF \(First Normal Form\):<\/strong>/);
});

test('3. Attendance reports: visual attendance block, <50% Low Attendance rule, No records rule, and zero exam eligibility text', () => {
  assert.equal(buildAttendanceProgressBar(80), '████████░░');

  const formatted = formatToolResult('get_my_attendance', {
    query: 'Show my attendance report',
    semesterNo: 3,
    overall: {
      attendancePercentage: 76.5,
      presentCount: 39,
      absentCount: 12,
      totalSessions: 51,
    },
    subjects: [
      {
        name: 'Database Management Systems',
        code: 'CSC206',
        attendancePercentage: 85,
        presentCount: 17,
        absentCount: 3,
        totalSessions: 20,
      },
      {
        name: 'Operating Systems',
        code: 'CSC207',
        attendancePercentage: 45,
        presentCount: 9,
        absentCount: 11,
        totalSessions: 20,
      },
      {
        name: 'Computer Networks',
        code: 'CSC208',
        attendancePercentage: null,
        presentCount: 0,
        absentCount: 0,
        totalSessions: 0,
      },
    ],
  });

  assert.match(formatted, /Your overall recorded attendance in Semester 3 is \*\*76\.5%\*\*/);
  assert.ok(!formatted.includes('| Subject |'), 'Must not use wide Markdown tables for attendance');
  assert.doesNotMatch(formatted, /Exam Eligibility|Cannot determine eligibility|Required threshold|Eligible for exams/i);
  assert.match(
    formatted,
    /- \*\*Database Management Systems\*\* \(CSC206\): \*\*85%\*\* \| 20 recorded classes \| Present: 17 \| Absent: 3/
  );
  assert.match(
    formatted,
    /- \*\*Operating Systems\*\* \(CSC207\): \*\*45%\*\* — Low Attendance \| 20 recorded classes \| Present: 9 \| Absent: 11/
  );
  assert.match(
    formatted,
    /- \*\*Computer Networks\*\* \(CSC208\): \*\*No records\*\*/
  );
});

test('4. Nested lists: multi-level ordered and unordered lists render with proper hierarchy', () => {
  const nestedMd = [
    '- CPU Scheduling Algorithms',
    '  - Preemptive Scheduling',
    '    - Round Robin (RR)',
    '    - Shortest Remaining Time First (SRTF)',
    '  - Non-Preemptive Scheduling',
    '    1. First Come First Served (FCFS)',
    '    2. Shortest Job First (SJF)',
  ].join('\n');

  const html = fallbackMarkdown(nestedMd);
  const ulCount = (html.match(/<ul>/g) || []).length;
  const olCount = (html.match(/<ol>/g) || []).length;
  assert.ok(ulCount >= 3, `Expected nested <ul> tags, got: ${html}`);
  assert.equal(olCount, 1, `Expected nested <ol> tag, got: ${html}`);
  assert.match(html, /Round Robin \(RR\)/);
  assert.match(html, /First Come First Served \(FCFS\)/);

  // Mobile PostMarkdown supports leading indentation on list items and nested bullet glyphs
  assert.ok(
    postMarkdownSource.includes("const unorderedGlyphs = ['•', '◦', '▪', '▫'];"),
    'Mobile PostMarkdown should define nested bullet glyphs'
  );
  assert.ok(
    postMarkdownSource.includes('paddingLeft: 4 + depth * 14'),
    'Mobile PostMarkdown should indent nested list items by depth'
  );
});

test('5. Large Markdown tables: wrapped in horizontal scroll container without breaking layout', () => {
  const tableMd = [
    '| Day | 07:00 - 08:30 | 08:30 - 10:00 | 10:30 - 12:00 | Room |',
    '| :--- | :---: | :---: | :---: | ---: |',
    '| Sunday | **DBMS** | Operating Systems | `Computer Networks` | Lab 302 |',
    '| Monday | Numerical Methods | **Software Eng.** | Free | Hall B |',
  ].join('\n');

  const html = fallbackMarkdown(tableMd);
  assert.match(html, /<div class="kyana-table-wrapper"><table class="kyana-table">/);
  assert.match(html, /<thead><tr><th style="text-align: left;">Day<\/th>/);
  assert.match(html, /<td style="text-align: center;"><strong>DBMS<\/strong><\/td>/);
  assert.match(html, /<td style="text-align: center;"><code>Computer Networks<\/code><\/td>/);
  assert.match(chatbotCssSource, /\.kyana-table-wrapper\s*\{[\s\S]*overflow-x:\s*auto/);
});

test('6. JavaScript, Python, and PHP code blocks: syntax highlighting + exact literal code preservation', () => {
  const jsCode = `function binarySearch(arr, target) {\n  let low = 0, high = arr.length - 1;\n  return low <= high ? low : -1;\n}`;
  const pyCode = `def factorial(n: int) -> int:\n    # Recursive base case\n    return 1 if n <= 1 else n * factorial(n - 1)`;
  const phpCode = `<?php\n$students = ["Saugat" => 88, "Aarav" => 92];\nforeach ($students as $name => $marks) {\n    echo $name . ": " . $marks;\n}\n?>`;

  const jsHighlighted = highlightChatCode(jsCode, 'javascript');
  const pyHighlighted = highlightChatCode(pyCode, 'python');
  const phpHighlighted = highlightChatCode(phpCode, 'php');

  assert.match(jsHighlighted, /class="token keyword">function<\/span>/);
  assert.match(jsHighlighted, /class="token function">binarySearch<\/span>/);
  assert.match(pyHighlighted, /class="token keyword">def<\/span>/);
  assert.match(pyHighlighted, /class="token comment"># Recursive base case<\/span>/);
  assert.match(phpHighlighted, /class="token keyword directive">&lt;\?php<\/span>/);
  assert.match(phpHighlighted, /class="token variable">\$students<\/span>/);
  assert.match(phpHighlighted, /class="token keyword">foreach<\/span>/);

  // Verify literal text after stripping HTML tags matches original code byte-for-byte
  const stripTagsAndUnescape = (str) =>
    str
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

  assert.equal(stripTagsAndUnescape(jsHighlighted), jsCode);
  assert.equal(stripTagsAndUnescape(pyHighlighted), pyCode);
  assert.equal(stripTagsAndUnescape(phpHighlighted), phpCode);
});

test('7. Mathematical equations: inline and multiline block LaTeX preserved without underscore/emphasis corruption', () => {
  const mathMd = [
    'The time complexity is $O(n \\log n)$ and the recurrence relation is \\(T(n) = 2T(n/2) + c_1\\).',
    '',
    '$$',
    'f(x_i) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x_i - \\mu}{\\sigma}\\right)^2}',
    '$$',
  ].join('\n');

  const html = fallbackMarkdown(mathMd);
  assert.match(html, /<span class="kyana-math-inline">\$O\(n \\log n\)\$<\/span>/);
  assert.match(html, /<span class="kyana-math-inline">\$T\(n\) = 2T\(n\/2\) \+ c_1\$<\/span>/);
  assert.match(html, /<div class="kyana-math-block">\$\$[\s\S]*x_i - \\mu[\s\S]*\$\$<\/div>/);
  // Ensure underscores inside LaTeX were NOT turned into <em> tags
  assert.ok(!html.includes('<em>i)'), 'Math subscripts must not be corrupted by Markdown emphasis');
});

test('8. Links and citations: external URLs and internal campus routes render as clickable links', () => {
  const linkMd =
    'Check your [Attendance](/attendance) or open the [Semester 3 Syllabus](/syllabus.html) and [TU Official Portal](https://tuexam.edu.np).';
  const html = fallbackMarkdown(linkMd);

  assert.match(
    html,
    /<a href="\/attendance" target="_blank" rel="noopener noreferrer">Attendance<\/a>/
  );
  assert.match(
    html,
    /<a href="\/syllabus\.html" target="_blank" rel="noopener noreferrer">Semester 3 Syllabus<\/a>/
  );
  assert.match(
    html,
    /<a href="https:\/\/tuexam\.edu\.np" target="_blank" rel="noopener noreferrer">TU Official Portal<\/a>/
  );
});

test('9. Romanized Nepali responses: natural Romanized Nepali tone without robotic headings or decorative emojis', () => {
  const rawReply =
    '### Direct Answer\n\n📚 Bholi **Database Management Systems (CSC206)** ko class bihana 7:00 AM ma cha.';
  const cleaned = styleLookupReply(rawReply, 'Bholi kun subject ko class cha?', {
    hasData: true,
  });

  assert.ok(!cleaned.includes('### Direct Answer'));
  assert.ok(!cleaned.includes('📚'), 'Should strip decorative leading emoji');
  assert.match(
    cleaned,
    /Bholi \*\*Database Management Systems \(CSC206\)\*\* ko class bihana 7:00 AM ma cha\./
  );
});

test('10. Streaming incomplete Markdown: unclosed code fences, partial math blocks, partial tables, and inline tokens stabilize cleanly', () => {
  // 10a. Unclosed code fence mid-stream
  const partialCodeStream = 'Here is the PHP example:\n```php\n<?php\n$total = 100;\necho $total;';
  const stabilizedCode = stabilizeStreamingMarkdown(partialCodeStream);
  assert.match(stabilizedCode, /```php[\s\S]*echo \$total;\n```$/);
  const renderedPartialCode = fallbackMarkdown(stabilizedCode);
  assert.match(renderedPartialCode, /<pre><code class="language-php">/);

  // 10b. Unclosed display math block mid-stream
  const partialMathStream = 'The quadratic formula is:\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
  const stabilizedMath = stabilizeStreamingMarkdown(partialMathStream);
  assert.match(stabilizedMath, /\$\$\nx = \\frac\{-b \\pm \\sqrt\{b\^2 - 4ac\}\}\{2a\}\n\$\$$/);

  // 10c. Trailing partial table delimiter row mid-stream
  const partialTableStream = '| Subject | Marks |\n| :-';
  const stabilizedTable = stabilizeStreamingMarkdown(partialTableStream);
  assert.match(stabilizedTable, /\| --- \| --- \|$/);

  // 10d. Unclosed bold & inline code on active line
  const partialInlineStream = 'Use the `SELECT * FROM students` query to fetch **all active';
  const stabilizedInline = stabilizeStreamingMarkdown(partialInlineStream);
  assert.equal(
    stabilizedInline,
    'Use the `SELECT * FROM students` query to fetch **all active**'
  );
});

test('11. Very long responses on mobile: code blocks and tables use horizontal ScrollViews and preserve Read More / Show Less controls', () => {
  assert.match(postMarkdownSource, /<ScrollView[\s\S]*?horizontal[\s\S]*?nestedScrollEnabled=\{true\}/);
  assert.match(postMarkdownSource, /accessibilityLabel="Read more"/);
  assert.match(postMarkdownSource, /accessibilityLabel="Show less"/);
  assert.match(postMarkdownSource, /accessibilityLabel="Copy code"/);
});

test('12. Web and mobile rendering consistency: both platforms implement streaming stabilization, syntax highlighting, math, nested lists, and copyable code blocks', () => {
  // Mobile PostMarkdown exports stabilizeStreamingMarkdown and formatMathExpression
  assert.match(postMarkdownSource, /export function stabilizeStreamingMarkdown/);
  assert.match(postMarkdownSource, /export function formatMathExpression/);
  assert.match(postMarkdownSource, /function renderHighlightedCode/);

  // Mobile Kyana screen passes streaming={true} to active streaming bubble
  assert.match(kyanaMobileSource, /<PostMarkdown[\s\S]*?content=\{streamingText\}[\s\S]*?streaming=\{true\}/);

  // Web chatbot.js exports stabilizeStreamingMarkdown, fallbackMarkdown, highlightChatCode
  assert.equal(typeof stabilizeStreamingMarkdown, 'function');
  assert.equal(typeof fallbackMarkdown, 'function');
  assert.equal(typeof highlightChatCode, 'function');
});
