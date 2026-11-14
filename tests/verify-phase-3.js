const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 4572;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ARTIFACT_DIR = '/Users/sauu_gat/.gemini/antigravity/brain/5b7ee805-798e-432d-bcf6-98fd86732595';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SAMPLE_LESSON_MARKDOWN = `# Unit 3: Propositional Logic & Computational Systems

Welcome to this comprehensive study lesson on **Propositional Logic** and **Database Query Systems** for Semester 1 BIT students at Gandaki University.

> "Logic is the anatomy of thought. Understanding its formal foundations empowers you to build correct algorithms, secure databases, and verify complex computational states."

---

## 1. Core Principles of Logic

In propositional logic, statements are evaluated based on their truth values:

1. **Primitive Propositions**: Declarative sentences that are either \`True (T)\` or \`False (F)\`.
   - *Example A*: "Pokhara is in Gandaki Province" evaluates to \`True\`.
   - *Example B*: "10 is an odd number" evaluates to \`False\`.
2. **Logical Connectives**:
   - **Conjunction** ($P \\land Q$): True only if both conjuncts are true.
   - **Disjunction** ($P \\lor Q$): True if at least one disjunct is true.
   - **Implication** ($P \\rightarrow Q$): False only when antecedent is true and consequent is false.
   - **Biconditional** ($P \\leftrightarrow Q$): True when both truth values match.

---

## 2. Mathematical Formalism & Proofs

Let us examine the mathematical formulation of formal logic and set intersections:

The general probability union and summation rule is defined as:
$$\\sum_{i=1}^{n} P(A_i) - \\sum_{i < j} P(A_i \\cap A_j) + \\cdots + (-1)^{n-1} P\\left(\\bigcap_{i=1}^n A_i\\right)$$

Furthermore, truth evaluations in system matrix form can be expressed as:
$$\\mathbf{M} = \\begin{pmatrix} 1 & 0 & 1 \\\\ 0 & 1 & 0 \\\\ 1 & 1 & 1 \\end{pmatrix}, \\quad \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$

---

## 3. Comparison of Logical Operators

The truth values and gate implementations compare as follows:

| Operator | Symbol | Boolean Expression | Gate Equivalent | Output on (1, 0) |
| :--- | :--- | :--- | :--- | :--- |
| **AND** | $\\land$ | $Y = A \\cdot B$ | Series Switch | \`0\` (Low) |
| **OR** | $\\lor$ | $Y = A + B$ | Parallel Switch | \`1\` (High) |
| **NOT** | $\\neg$ | $Y = \\bar{A}$ | Inverter | \`0\` (Inverted) |
| **XOR** | $\\oplus$ | $Y = A\\bar{B} + \\bar{A}B$ | Parity Checker | \`1\` (High) |

---

## 4. Multi-Language Code Implementations

### PHP Backend Session Validation
\`\`\`php
<?php
// Verify academic student authentication token
session_start();
if (!isset($_SESSION['student_id'])) {
    header('HTTP/1.1 401 Unauthorized');
    echo json_encode(['error' => 'Authentication required']);
    exit();
}
$studentId = htmlspecialchars($_SESSION['student_id'], ENT_QUOTES, 'UTF-8');
echo json_encode(['status' => 'active', 'student' => $studentId]);
?>
\`\`\`

### JavaScript Truth Table Generator
\`\`\`javascript
// Compute all permutations of truth assignments for n propositional variables
function generateTruthTable(variables) {
  const n = variables.length;
  const rows = Math.pow(2, n);
  const table = [];
  for (let i = 0; i < rows; i++) {
    const row = {};
    variables.forEach((v, idx) => {
      row[v] = Boolean((i >> (n - 1 - idx)) & 1);
    });
    table.push(row);
  }
  return table;
}
console.log(generateTruthTable(['P', 'Q']));
\`\`\`

### Python Logic Solver
\`\`\`python
def evaluate_implication(p: bool, q: bool) -> bool:
    """Implication P -> Q is equivalent to NOT P OR Q."""
    return (not p) or q

def evaluate_biconditional(p: bool, q: bool) -> bool:
    """Biconditional P <-> Q is true when both operands match."""
    return p == q

print("P=True, Q=False =>", evaluate_implication(True, False))
\`\`\`

### SQL Academic Record Query
\`\`\`sql
SELECT
    s.student_id,
    s.full_name,
    c.course_code,
    c.course_name,
    m.marks_obtained,
    m.grade_point
FROM students s
JOIN enrollments e ON s.id = e.student_id
JOIN courses c ON e.course_id = c.id
LEFT JOIN marks m ON m.enrollment_id = e.id
WHERE s.semester = 1 AND c.nature = 'Theory'
ORDER BY m.marks_obtained DESC;
\`\`\`

### C Embedded Logic Gate Verification
\`\`\`c
#include <stdio.h>
#include <stdbool.h>

int main(void) {
    bool A = true;
    bool B = false;
    bool Y_and = A && B;
    bool Y_or  = A || B;
    bool Y_xor = A ^ B;

    printf("A=%d, B=%d | AND=%d, OR=%d, XOR=%d\\n", A, B, Y_and, Y_or, Y_xor);
    return 0;
}
\`\`\`
`;

const SAMPLE_RESOURCE_CARDS = [
  {
    id: 101,
    type: 'note',
    action: 'open_note',
    title: 'Discrete Mathematics Unit 1 Notes.pdf',
    subject: 'Discrete Mathematics',
    semester: '1'
  },
  {
    id: 102,
    type: 'routine',
    action: 'view_routine',
    title: 'Gandaki University BIT 1st Sem Exam Schedule.pdf',
    subject: 'Exam Routine',
    semester: '1'
  },
  {
    id: 103,
    type: 'note',
    action: 'open_note',
    title: '2023 Model Question Solutions - CIT121.pdf',
    subject: 'CIT121',
    semester: '1'
  }
];

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  if (pathname === '/api/profile') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'usr-student-shree',
      name: 'Shree',
      username: 'shree',
      role: 'student',
      studentId: 'BIT-2024-001'
    }));
    return;
  }

  if (pathname === '/api/conversations') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  if (pathname === '/api/ai/chat' || pathname === '/api/ai/chat/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    // Send in chunks as SSE event: delta
    const lines = SAMPLE_LESSON_MARKDOWN.split('\n');
    let chunk = '';
    lines.forEach((l, i) => {
      chunk += l + '\n';
      if (i % 6 === 0) {
        res.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
        chunk = '';
      }
    });
    if (chunk) {
      res.write(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    // Final result event
    res.write(`event: result\ndata: ${JSON.stringify({
      reply: SAMPLE_LESSON_MARKDOWN,
      resourceCards: SAMPLE_RESOURCE_CARDS,
      conversationId: 'ses-phase-3'
    })}\n\n`);
    res.end();
    return;
  }

  if (pathname === '/') pathname = '/chatbot.html';
  const filePath = path.join(PUBLIC_DIR, pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

async function runPhase3Verification() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Phase 3 Test server running at http://localhost:${PORT}`);

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Desktop Viewport (1440x900) - Full Academic Lesson Render
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Desktop Viewport (1440x900) - Full Academic Lesson ---');
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark'
    });
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('sb-local-auth-token', JSON.stringify({
        access_token: 'test-token',
        user: { id: 'usr-student-shree', user_metadata: { name: 'Shree', role: 'student', student_id: 'BIT-2024-001' } }
      }));
      sessionStorage.setItem('sl_user_cache', JSON.stringify({
        id: 'usr-student-shree',
        name: 'Shree',
        role: 'student'
      }));
    });

    await page.goto(`http://localhost:${PORT}/chatbot.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Ask Kyana to teach Unit 1
    await page.fill('#kyanaInput', 'Teach me Unit 3 completely with mathematical formulations, comparison tables, code examples, and notes.');
    await page.dispatchEvent('#kyanaInput', 'input');
    await page.waitForTimeout(200);
    await page.press('#kyanaInput', 'Enter');
    console.log('[ACTION] Sent teaching prompt to Kyana...');

    // Wait for the response stream to complete
    await page.waitForSelector('.kyana-response-actions', { timeout: 15000 });
    await page.waitForTimeout(1000); // Allow KaTeX and Prism rendering to settle

    // Assert Typography elements
    const h1Count = await page.$$eval('.kyana-response-doc h1', els => els.length);
    const h2Count = await page.$$eval('.kyana-response-doc h2', els => els.length);
    const pCount = await page.$$eval('.kyana-response-doc p', els => els.length);
    const bqCount = await page.$$eval('.kyana-response-doc blockquote', els => els.length);
    const hrCount = await page.$$eval('.kyana-response-doc hr', els => els.length);
    const inlineCodeCount = await page.$$eval('.kyana-response-doc :not(pre) > code', els => els.length);
    console.log(`[PASS] Typography counts: H1=${h1Count}, H2=${h2Count}, P=${pCount}, Blockquote=${bqCount}, HR=${hrCount}, InlineCode=${inlineCodeCount}`);
    if (h1Count < 1 || h2Count < 4 || pCount < 5 || bqCount < 1) {
      throw new Error('Typography hierarchy missing expected elements!');
    }

    // Assert Table rendering
    const tableWrapCount = await page.$$eval('.kyana-table-wrapper', els => els.length);
    const thCount = await page.$$eval('.kyana-table-wrapper th', els => els.length);
    console.log(`[PASS] Responsive Table wrapper count: ${tableWrapCount}, Header count: ${thCount}`);
    if (tableWrapCount < 1 || thCount < 4) throw new Error('Table wrapper not created!');

    // Assert KaTeX rendering
    const katexCount = await page.$$eval('.katex', els => els.length);
    const katexDisplayCount = await page.$$eval('.katex-display', els => els.length);
    console.log(`[PASS] KaTeX math equations rendered: total=${katexCount}, displayBlock=${katexDisplayCount}`);
    if (katexCount < 5 || katexDisplayCount < 2) throw new Error('KaTeX math failed to render!');

    // Assert Code Blocks & Languages (PHP, JS, Python, SQL, C)
    const codeBlocks = await page.$$eval('.kyana-code-block', els => els.map(e => e.dataset.lang));
    console.log(`[PASS] Rendered code blocks:`, codeBlocks);
    const expectedLangs = ['php', 'javascript', 'python', 'sql', 'c'];
    for (const l of expectedLangs) {
      if (!codeBlocks.includes(l)) {
        throw new Error(`Expected code block for language '${l}' not found!`);
      }
    }

    // Assert Code Copy button & feedback
    console.log('[ACTION] Testing code block copy button...');
    const firstCopyBtn = await page.$('.kyana-copy-code-btn');
    if (firstCopyBtn) {
      await firstCopyBtn.click();
      await page.waitForTimeout(200);
      const isCopied = await page.$eval('.kyana-copy-code-btn', el => el.classList.contains('copied'));
      console.log(`[PASS] Code copy button feedback active (.copied): ${isCopied}`);
      if (!isCopied) throw new Error('Code copy button did not trigger copied feedback state!');
    }

    // Assert Academic Resource Cards
    const resourceCardsCount = await page.$$eval('.kyana-source-card', els => els.length);
    const resourceTitles = await page.$$eval('.kyana-source-title', els => els.map(e => e.textContent.trim()));
    console.log(`[PASS] Academic resource cards count: ${resourceCardsCount}, Titles:`, resourceTitles);
    if (resourceCardsCount < 3) throw new Error('Academic resource cards failed to render!');

    // Assert Response Action buttons
    const copyResponseBtn = await page.$('.kyana-response-actions .kyana-copy-btn');
    const helpfulBtn = await page.$('.kyana-response-actions .kyana-helpful-btn');
    const unhelpfulBtn = await page.$('.kyana-response-actions .kyana-unhelpful-btn');
    const regenBtn = await page.$('.kyana-response-actions .kyana-regen-btn');
    console.log(`[PASS] Response actions presence: copy=${!!copyResponseBtn}, helpful=${!!helpfulBtn}, unhelpful=${!!unhelpfulBtn}, regen=${!!regenBtn}`);
    if (!copyResponseBtn || !helpfulBtn || !unhelpfulBtn || !regenBtn) {
      throw new Error('Response action controls missing!');
    }

    // Click helpful feedback
    await helpfulBtn.click();
    const isHelpfulActive = await page.$eval('.kyana-response-actions .kyana-helpful-btn', el => el.classList.contains('active'));
    console.log(`[PASS] Helpful feedback button toggled active: ${isHelpfulActive}`);
    if (!isHelpfulActive) throw new Error('Helpful feedback toggle failed!');

    // Capture Full Academic Lesson Screenshot (1440x900)
    const lessonScreenshotPath = path.join(ARTIFACT_DIR, 'phase-3-desktop-lesson-1440x900.png');
    await page.screenshot({ path: lessonScreenshotPath, fullPage: false });
    console.log(`[SCREENSHOT] Saved: ${lessonScreenshotPath}`);

    // Scroll to Math & Code sections and capture
    await page.evaluate(() => {
      const el = document.querySelector('.kyana-table-wrapper');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(300);
    const mathTableScreenshotPath = path.join(ARTIFACT_DIR, 'phase-3-desktop-math-table.png');
    await page.screenshot({ path: mathTableScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${mathTableScreenshotPath}`);

    // Scroll to Code Blocks section and capture
    await page.evaluate(() => {
      const el = document.querySelector('.kyana-code-block[data-lang="php"]');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(300);
    const codeScreenshotPath = path.join(ARTIFACT_DIR, 'phase-3-desktop-code-blocks.png');
    await page.screenshot({ path: codeScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${codeScreenshotPath}`);

    // Scroll to Academic Resource Cards and capture
    await page.evaluate(() => {
      const el = document.querySelector('.kyana-sources-wrap');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(300);
    const resourcesScreenshotPath = path.join(ARTIFACT_DIR, 'phase-3-desktop-resources.png');
    await page.screenshot({ path: resourcesScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${resourcesScreenshotPath}`);

    await context.close();

    // -------------------------------------------------------------
    // Test 2: Multi-Resolution Responsiveness (1920x1080, 1280x720, 390x844, 375x812)
    // -------------------------------------------------------------
    const resolutions = [
      { name: 'desktop-1920x1080', width: 1920, height: 1080 },
      { name: 'desktop-1280x720', width: 1280, height: 720 },
      { name: 'mobile-390x844', width: 390, height: 844, mobile: true },
      { name: 'mobile-375x812', width: 375, height: 812, mobile: true }
    ];

    for (const res of resolutions) {
      console.log(`\n--- Testing Resolution: ${res.name} (${res.width}x${res.height}) ---`);
      const ctx = await browser.newContext({
        viewport: { width: res.width, height: res.height },
        colorScheme: 'dark',
        userAgent: res.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)' : undefined
      });
      const p = await ctx.newPage();
      await p.addInitScript(() => {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('sb-local-auth-token', JSON.stringify({
          access_token: 'test-token',
          user: { id: 'usr-student-shree', user_metadata: { name: 'Shree', role: 'student', student_id: 'BIT-2024-001' } }
        }));
        sessionStorage.setItem('sl_user_cache', JSON.stringify({
          id: 'usr-student-shree',
          name: 'Shree',
          role: 'student'
        }));
      });

      await p.goto(`http://localhost:${PORT}/chatbot.html`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(400);

      // Send prompt
      await p.fill('#kyanaInput', 'Teach me Unit 3');
      await p.dispatchEvent('#kyanaInput', 'input');
      await p.waitForTimeout(200);
      await p.press('#kyanaInput', 'Enter');
      await p.waitForSelector('.kyana-response-actions', { timeout: 15000 });
      await p.waitForTimeout(600);

      // Check horizontal overflow of body
      const hasHorizontalScroll = await p.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      console.log(`[PASS] Resolution ${res.name} horizontal overflow detected: ${hasHorizontalScroll} (expected false)`);
      if (hasHorizontalScroll) {
        throw new Error(`Horizontal overflow detected at ${res.width}x${res.height}!`);
      }

      const resScreenshotPath = path.join(ARTIFACT_DIR, `phase-3-${res.name}.png`);
      await p.screenshot({ path: resScreenshotPath });
      console.log(`[SCREENSHOT] Saved: ${resScreenshotPath}`);
      await ctx.close();
    }

    console.log('\n=============================================');
    console.log('ALL PHASE 3 CONVERSATION & RENDERING TESTS PASSED!');
    console.log('=============================================\n');

  } finally {
    await browser.close();
    server.close();
  }
}

runPhase3Verification().catch(err => {
  console.error('\n[PHASE 3 TEST FAILURE]', err);
  process.exit(1);
});
