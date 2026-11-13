'use strict';

const fs = require('fs');
const path = require('path');

// 1. Load env vars
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

async function runDemoQuestions() {
  console.log('Starting Kyana Multi-Capability Live Q&A Generation...\n');
  const provider = createChatProvider({ env: process.env, timeoutMs: 30000 });

  const testCases = [
    {
      id: 1,
      topic: 'Digital Logic & Sequential Circuits',
      question: 'Explain the sequential circuit diagram on page 6 of Lecture 9. Include its Boolean feedback equation, and summarize how input and present state determine the next state in a truth table.',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 3: Finite state Automata, Grammars and Languages',
      unitNumber: 3,
      semesterNo: 2,
      fileIds: [90]
    },
    {
      id: 2,
      topic: 'Engineering Mathematics & Differential Equations',
      question: 'Explain the 2nd order differential equation on page 11 of U4 L7. Derive its characteristic equation, show the roots calculation, and provide a summary table showing how root types determine the general solution form.',
      subject: 'Mathematics II',
      chapterTitle: 'Unit 4: Differential Equations',
      unitNumber: 4,
      semesterNo: 2,
      fileIds: [47]
    },
    {
      id: 3,
      topic: 'Discrete Mathematics & Graph Theory',
      question: 'Explain the undirected graph diagram on page 7 of Lecture 13. State the Handshaking Theorem formula, list the vertices and their degrees from the diagram, and format the vertex degrees in a table.',
      subject: 'Discrete Mathematics',
      chapterTitle: 'Unit 5: Graph Theory',
      unitNumber: 5,
      semesterNo: 2,
      fileIds: [98]
    }
  ];

  const results = [];

  for (const tc of testCases) {
    console.log(`========================================================================`);
    console.log(`[Q${tc.id}] ${tc.topic}`);
    console.log(`Question: "${tc.question}"`);
    console.log(`========================================================================`);

    const t0 = performance.now();
    let attachedImages = [];
    const wrappedGenerateReply = async (params) => {
      if (params.message && typeof params.message === 'object' && Array.isArray(params.message.images)) {
        attachedImages = params.message.images.map(img => ({
          mimeType: img.mimeType,
          sizeBytes: img.data ? img.data.length : 0,
          pageNumber: img.metadata ? img.metadata.pageNumber : null
        }));
      }
      return provider.generateReply(params);
    };

    const reply = await answerWithChapterContext(db, {
      message: tc.question,
      chapterContext: {
        subject: tc.subject,
        chapterTitle: tc.chapterTitle,
        unitNumber: tc.unitNumber,
        semesterNo: tc.semesterNo,
        fileIds: tc.fileIds
      },
      academicContext: {
        authenticated: true,
        role: 'student',
        cohort: { id: 1, currentSemester: tc.semesterNo }
      },
      generateReplyFn: wrappedGenerateReply
    });

    const elapsedMs = Math.round(performance.now() - t0);
    console.log(`Time taken: ${elapsedMs} ms`);
    console.log(`Images attached: ${attachedImages.length}`);
    console.log(`Visual evidence used: ${reply.chapterTutor ? reply.chapterTutor.visualEvidenceUsed : false}`);
    console.log(`Reply snippet:\n${reply.reply.slice(0, 300)}...\n`);

    results.push({
      id: tc.id,
      topic: tc.topic,
      question: tc.question,
      subject: tc.subject,
      chapterTitle: tc.chapterTitle,
      attachedImages,
      citations: reply.citations || [],
      visualEvidenceUsed: reply.chapterTutor ? reply.chapterTutor.visualEvidenceUsed : false,
      elapsedMs,
      fullReply: reply.reply
    });
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'multimodal-demo-qa.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log('Saved all Q&A results to multimodal-demo-qa.json');
}

runDemoQuestions().then(() => process.exit(0)).catch(err => {
  console.error('Error generating demo answers:', err);
  process.exit(1);
});

