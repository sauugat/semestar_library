const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getChapterReaderBundle,
  analyzeChapterStudentQuestion,
  answerWithChapterContext
} = require('../lib/chapter-tutor-engine');
const { handleChat } = require('../ai-assistant');

function createMockChapterDb() {
  const files = [
    {
      id: 301,
      title: 'Chapter 3 CSS Complete Notes.pdf',
      originalName: 'Chapter 3 CSS Complete Notes.pdf',
      storedName: 'css-complete-notes.pdf',
      subject: 'Web Technology I',
      subject_code: 'CIT123',
      semester: '3',
      semester_no: 3,
      unit_number: 3,
      chapter: 'Unit 3: Cascading Style Sheets (CSS)',
      resource_category: 'notes',
      sort_order: 1
    },
    {
      id: 302,
      title: 'CSS Practical Examples.pdf',
      originalName: 'CSS Practical Examples.pdf',
      storedName: 'css-practical-examples.pdf',
      subject: 'Web Technology I',
      subject_code: 'CIT123',
      semester: '3',
      semester_no: 3,
      unit_number: 3,
      chapter: 'Unit 3: Cascading Style Sheets (CSS)',
      resource_category: 'notes',
      sort_order: 2
    }
  ];

  const pages = [
    {
      file_id: 301,
      page_number: 1,
      cleaned_text: 'Introduction to CSS. CSS stands for Cascading Style Sheets. Inline, internal, and external stylesheets.'
    },
    {
      file_id: 301,
      page_number: 2,
      cleaned_text: 'CSS Selectors: Element selector, Class selector (.box), and ID selector (#header). Specificity rules determine which style wins.'
    },
    {
      file_id: 302,
      page_number: 1,
      cleaned_text: 'Practical Example 1: Using class and ID selectors in HTML.\n.card { padding: 16px; border: 1px solid #111; }\n#main-title { color: navy; }'
    },
    {
      file_id: 302,
      page_number: 2,
      cleaned_text: 'Practical Example 2: Box model demonstration with margin, border, padding, and content width.'
    }
  ];

  const chunks = pages.map((p, idx) => ({
    id: 900 + idx,
    file_id: p.file_id,
    chunk_index: idx,
    page_start: p.page_number,
    page_end: p.page_number,
    section_heading: p.file_id === 301 ? 'CSS Selectors & Theory' : 'CSS Practical Examples',
    clean_content: p.cleaned_text,
    file_title: p.file_id === 301 ? 'Chapter 3 CSS Complete Notes.pdf' : 'CSS Practical Examples.pdf',
    original_name: p.file_id === 301 ? 'Chapter 3 CSS Complete Notes.pdf' : 'CSS Practical Examples.pdf'
  }));

  const extractedItems = [
    {
      id: 1,
      file_id: 301,
      item_type: 'definition',
      title: 'CSS Selector Definition',
      topic: 'CSS Selectors',
      concept_key: 'css_selectors',
      content_text: 'A CSS selector patterns elements in an HTML document so declarations can style them.',
      page_start: 2,
      page_end: 2
    },
    {
      id: 2,
      file_id: 302,
      item_type: 'code_example',
      title: 'Class vs ID Selector Code',
      topic: 'CSS Selectors',
      concept_key: 'css_selectors',
      content_text: '.card { padding: 16px; }\n#main-title { font-weight: bold; }',
      page_start: 1,
      page_end: 1
    }
  ];

  return {
    async all(sql, ...params) {
      const flatParams = params.flat();
      const q = String(sql || '').toLowerCase();
      if (q.includes('from files') && !q.includes('join files')) {
        return files;
      }
      if (q.includes('from document_pages')) {
        const fid = Number(flatParams[0]);
        return pages.filter((p) => p.file_id === fid);
      }
      if (q.includes('from academic_extracted_items')) {
        const fid = Number(flatParams[0]);
        return extractedItems.filter((it) => it.file_id === fid);
      }
      if (q.includes('from document_chunks')) {
        if (q.includes('join files')) {
          return chunks;
        }
        const fid = Number(flatParams[0]);
        return chunks.filter((c) => c.file_id === fid);
      }
      return [];
    },
    async get() {
      return null;
    },
    async run() {
      return { changes: 1 };
    },
    async exec() {
      return true;
    }
  };
}

test('Chapter Tutor Workspace — Continuous Multi-PDF Bundle + Grounded Q&A + Follow-up Memory + Fallback + Teach Trigger', async (t) => {
  const db = createMockChapterDb();
  const academicContext = {
    authenticated: true,
    studentId: 10,
    role: 'student',
    currentSemester: 3
  };

  await t.test('1. getChapterReaderBundle loads multiple chapter PDFs in sequence with pages, extracted items, and syllabus topics', async () => {
    const bundle = await getChapterReaderBundle(db, {
      academicContext,
      subject: 'Web Technology I',
      subjectCode: 'CIT123',
      semesterNo: 3,
      unitNumber: 3,
      chapterTitle: 'Unit 3: Cascading Style Sheets (CSS)',
      fileIds: [301, 302]
    });

    assert.equal(bundle.files.length, 2, 'Should return both PDFs in the chapter');
    assert.equal(bundle.files[0].id, 301);
    assert.equal(bundle.files[0].orderIndex, 1);
    assert.equal(bundle.files[0].pages.length, 2);
    assert.equal(bundle.files[1].id, 302);
    assert.equal(bundle.files[1].orderIndex, 2);
    assert.equal(bundle.files[1].pages.length, 2);
    assert.ok(Array.isArray(bundle.syllabusTopics), 'Should include official chapter syllabus topics array');
  });

  await t.test('2. Direct student question uses Think -> Lookup Chapter PDFs & Syllabus -> Answer pipeline across multiple PDFs', async () => {
    const res = await answerWithChapterContext(db, {
      academicContext,
      message: 'What are CSS selectors and how do class and ID selectors work?',
      history: [],
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT123',
        semesterNo: 3,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Cascading Style Sheets (CSS)',
        fileIds: [301, 302]
      }
    });

    assert.equal(res.mode, 'chapter_qa');
    assert.equal(res.intent, 'chapter_tutor');
    assert.equal(res.chapterTutor.foundInNotes, true);
    assert.equal(res.chapterTutor.usedFallbackKnowledge, false);
    assert.match(res.reply, /Chapter 3 CSS Complete Notes\.pdf|CSS Practical Examples\.pdf/i);
    assert.match(res.reply, /selector/i);
  });

  await t.test('3. Follow-up question ("I don\'t understand, give me an example") resolves prior topic from chat history', async () => {
    const history = [
      { role: 'user', content: 'What are CSS selectors and specificity?' },
      { role: 'assistant', content: 'CSS selectors target HTML elements (element, .class, #id) and specificity decides which rule wins.' }
    ];

    const res = await answerWithChapterContext(db, {
      academicContext,
      message: "I don't understand, can you give me a practical example?",
      history,
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT123',
        semesterNo: 3,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Cascading Style Sheets (CSS)',
        fileIds: [301, 302]
      }
    });

    assert.equal(res.mode, 'chapter_qa');
    assert.equal(res.chapterTutor.isConfusionFollowUp, true);
    assert.equal(res.chapterTutor.wantsExample, true);
    assert.match(res.chapterTutor.resolvedTopic, /CSS selectors/i);
    assert.equal(res.chapterTutor.foundInNotes, true);
    assert.match(res.reply, /\.card|#main-title|selector/i);
  });

  await t.test('4. Topic missing from uploaded chapter PDFs transparently falls back to LLM knowledge + chapter syllabus', async () => {
    const res = await answerWithChapterContext(db, {
      academicContext,
      message: 'Explain quantum entanglement in superconductors',
      history: [],
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT123',
        semesterNo: 3,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Cascading Style Sheets (CSS)',
        fileIds: [301, 302]
      }
    });

    assert.equal(res.mode, 'chapter_qa');
    assert.equal(res.chapterTutor.foundInNotes, false);
    assert.equal(res.chapterTutor.usedFallbackKnowledge, true);
    assert.ok(res.reply.length > 40);
  });

  await t.test('5. Explicit "Teach me this chapter" triggers step-by-step Study Partner mode instead of single Q&A', async () => {
    const reasoning = analyzeChapterStudentQuestion(
      'Teach me this chapter step by step',
      [],
      ['CSS Selectors']
    );
    assert.equal(reasoning.isExplicitChapterTeachRequest, true);

    const delegated = await answerWithChapterContext(db, {
      academicContext,
      message: 'Teach me this chapter step by step',
      history: [],
      chapterContext: {
        subject: 'Web Technology I',
        subjectCode: 'CIT123',
        semesterNo: 3,
        unitNumber: 3,
        chapterTitle: 'Unit 3: Cascading Style Sheets (CSS)',
        fileIds: [301, 302]
      }
    });
    assert.equal(delegated.delegateToStudyPartner, true);
  });
});
