'use strict';

/**
 * Phase 2.3 — Real PDF Visual Understanding End-to-End Validation
 * Validates the complete pipeline on real Gandaki University academic PDFs:
 * PDF storage -> page metadata -> page image resolution -> visual retrieval ->
 * provider transport -> answer generation -> citation rendering.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Load environment variables from .env / .env.local
for (const envFile of ['.env.local', '.env']) {
  const envPath = path.resolve(__dirname, '..', envFile);
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

const db = require('../db');
const { answerWithChapterContext } = require('../lib/chapter-tutor-engine');
const { createChatProvider } = require('../lib/chat-provider');

async function runEndToEndValidation() {
  console.log('========================================================================');
  console.log('  Phase 2.3 — Real PDF Visual Understanding: End-to-End Validation');
  console.log('========================================================================\n');

  const provider = createChatProvider({ env: process.env });
  const validationResults = [];

  const scenarios = [
    {
      id: 1,
      name: 'Digital Logic / Sequential Circuit Diagram',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 3: Finite state Automata, Grammars and Languages',
      unitNumber: 3,
      semesterNo: 2,
      fileIds: [90],
      question: 'Explain the sequential circuit diagram on page 6. What are the components and feedback connections?',
      expectedPage: 6,
      expectedKind: 'pdf_page',
      shouldAttachImage: true,
      checkAnswerKeywords: ['combinational', 'memory', 'feedback', 'input', 'output']
    },
    {
      id: 2,
      name: 'Mathematics / 2nd Order Differential Equation Derivation',
      subject: 'Mathematics II',
      chapterTitle: 'Unit 4: Differential Equations',
      unitNumber: 4,
      semesterNo: 2,
      fileIds: [47],
      question: 'Explain the differential equation solution and characteristic equation derivation for Example 1 on page 11.',
      expectedPage: 11,
      expectedKind: 'pdf_page',
      shouldAttachImage: true,
      checkAnswerKeywords: ['characteristic', 'equation', 'solution', 'roots', 'y']
    },
    {
      id: 3,
      name: 'Graph / Undirected Graph Vertices and Edges',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 5: Graph Theory',
      unitNumber: 5,
      semesterNo: 2,
      fileIds: [98],
      question: 'Explain the undirected graph diagram and vertices on page 7.',
      expectedPage: 7,
      expectedKind: 'pdf_page',
      shouldAttachImage: true,
      checkAnswerKeywords: ['undirected', 'graph', 'vert']
    },
    {
      id: 4,
      name: 'Specific Page Retrieval / Pseudograph on Page 10',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 5: Graph Theory',
      unitNumber: 5,
      semesterNo: 2,
      fileIds: [98],
      question: 'What is on page 10 of this graph theory lecture? Explain the pseudograph diagram.',
      expectedPage: 10,
      expectedKind: 'pdf_page',
      shouldAttachImage: true,
      checkAnswerKeywords: ['pseudograph', 'loop', 'edge']
    },
    {
      id: 5,
      name: 'Text-Only Question / Conceptual Comparison (Zero Image Attachment)',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 3: Finite state Automata, Grammars and Languages',
      unitNumber: 3,
      semesterNo: 2,
      fileIds: [90],
      question: 'What is the primary difference between combinational circuits and sequential circuits conceptually?',
      expectedPage: null,
      shouldAttachImage: false,
      checkAnswerKeywords: ['combinational', 'sequential', 'memory']
    }
  ];

  for (const sc of scenarios) {
    console.log(`------------------------------------------------------------------------`);
    console.log(`Running Scenario ${sc.id}: ${sc.name}`);
    console.log(`Question: "${sc.question}"`);
    console.log(`File: [${sc.fileIds.join(', ')}] | Chapter: ${sc.chapterTitle}`);

    const startTime = Date.now();
    let receivedPayload = null;
    let transportCalled = false;
    let providerUsed = 'unknown';

    try {
      const res = await answerWithChapterContext(db, {
        message: sc.question,
        chapterContext: {
          subject: sc.subject,
          chapterTitle: sc.chapterTitle,
          unitNumber: sc.unitNumber,
          semesterNo: sc.semesterNo,
          fileIds: sc.fileIds
        },
        academicContext: {
          authenticated: true,
          role: 'student',
          cohort: { id: 2, currentSemester: sc.semesterNo }
        },
        generateReplyFn: async (args) => {
          transportCalled = true;
          receivedPayload = args.message;
          providerUsed = process.env.CHAT_PROVIDER || 'gemini (gemini-3-flash-preview)';
          return provider.generateReply(args);
        }
      });

      const latencyMs = Date.now() - startTime;
      const visualUsed = Boolean(res.chapterTutor && res.chapterTutor.visualEvidenceUsed);
      const isMultimodalPayload = receivedPayload && typeof receivedPayload === 'object' && Array.isArray(receivedPayload.images);
      const imagesCount = isMultimodalPayload ? receivedPayload.images.length : 0;
      const firstImage = imagesCount > 0 ? receivedPayload.images[0] : null;

      const attachedFileId = firstImage?.metadata?.fileId || null;
      const attachedPageNo = firstImage?.metadata?.pageNumber || null;
      const bufferBytes = firstImage?.data ? firstImage.data.length : 0;

      const visualCitation = (res.citations || []).find((c) => c.evidenceOrigin === 'visual_evidence');
      const citationAccurate = sc.shouldAttachImage
        ? Boolean(visualCitation && Number(visualCitation.pageStart) === Number(sc.expectedPage))
        : !visualCitation;

      // Check keywords
      const replyLower = (res.reply || '').toLowerCase();
      const matchedKeywords = sc.checkAnswerKeywords.filter((kw) => replyLower.includes(kw.toLowerCase()));
      const answerCorrect = matchedKeywords.length >= Math.ceil(sc.checkAnswerKeywords.length * 0.5);

      const record = {
        scenarioId: sc.id,
        scenarioName: sc.name,
        question: sc.question,
        retrievedDocumentId: attachedFileId,
        retrievedPage: attachedPageNo,
        expectedPage: sc.expectedPage,
        imageBufferReachedProvider: imagesCount > 0 && bufferBytes > 0,
        bufferBytes,
        providerUsed,
        visualEvidenceUsed: visualUsed,
        citationAccurate,
        visualCitation,
        answerCorrect,
        matchedKeywords,
        latencyMs,
        error: null,
        replySnippet: (res.reply || '').replace(/\s+/g, ' ').slice(0, 200) + '...'
      };

      validationResults.push(record);

      console.log(`Result:`);
      console.log(`  - Latency: ${latencyMs} ms`);
      console.log(`  - Image Attached: ${imagesCount} (Bytes: ${bufferBytes})`);
      console.log(`  - Page Retrieved: ${attachedPageNo} (Expected: ${sc.expectedPage})`);
      console.log(`  - Visual Citation: ${visualCitation ? `Page ${visualCitation.pageStart}` : 'None'} (Accurate: ${citationAccurate})`);
      console.log(`  - Answer Keywords: ${matchedKeywords.join(', ')} (Correct: ${answerCorrect})`);
      console.log(`  - Reply: ${record.replySnippet}\n`);

      // Strict assertions
      if (sc.shouldAttachImage) {
        assert.ok(isMultimodalPayload, `Scenario ${sc.id}: Expected multimodal payload`);
        assert.equal(imagesCount, 1, `Scenario ${sc.id}: Expected exactly 1 image attached`);
        assert.equal(attachedPageNo, sc.expectedPage, `Scenario ${sc.id}: Expected page ${sc.expectedPage}, got ${attachedPageNo}`);
        assert.ok(bufferBytes > 1000, `Scenario ${sc.id}: Expected valid image buffer > 1KB, got ${bufferBytes}`);
        assert.ok(visualCitation, `Scenario ${sc.id}: Expected visual evidence citation`);
        assert.equal(visualCitation.pageStart, sc.expectedPage, `Scenario ${sc.id}: Citation page mismatch`);
        assert.ok(answerCorrect, `Scenario ${sc.id}: Answer must be academically correct`);
      } else {
        assert.equal(imagesCount, 0, `Scenario ${sc.id}: Conceptual question must NOT attach images`);
        assert.equal(visualUsed, false, `Scenario ${sc.id}: visualEvidenceUsed must be false`);
        assert.ok(answerCorrect, `Scenario ${sc.id}: Answer must be correct`);
      }
    } catch (err) {
      console.error(`Scenario ${sc.id} FAILED:`, err.message);
      validationResults.push({
        scenarioId: sc.id,
        scenarioName: sc.name,
        question: sc.question,
        error: err.message,
        latencyMs: Date.now() - startTime
      });
      throw err;
    }
  }

  console.log('========================================================================');
  console.log('  ALL 5 REAL PDF END-TO-END SCENARIOS VALIDATED SUCCESSFULLY!');
  console.log('========================================================================\n');

  fs.writeFileSync(
    path.join(__dirname, '..', 'phase2-3-validation-report.json'),
    JSON.stringify(validationResults, null, 2),
    'utf8'
  );
  console.log('Saved phase2-3-validation-report.json successfully.');
}

runEndToEndValidation()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal Validation Error:', err);
    process.exit(1);
  });

