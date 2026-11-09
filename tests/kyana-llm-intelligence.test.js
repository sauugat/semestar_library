'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { handleChat, invalidateCache, clearPaginationState } = require('../ai-assistant');
const { createTools, routeQuery } = require('../lib/chat-tools');
const { detectLanguage } = require('../lib/chat-personality');

function createMockStudentDb() {
  const attendanceRows = [
    {
      subject_id: 201,
      subject_code: 'CIT114',
      subject_name: 'Data Structures and Algorithms',
      semester: 2,
      total_sessions: 20,
      present_count: 17,
      absent_count: 3
    },
    {
      subject_id: 202,
      subject_code: 'CIT112',
      subject_name: 'Computer Programming II (Java)',
      semester: 2,
      total_sessions: 18,
      present_count: 15,
      absent_count: 3
    }
  ];

  const publishedResultsRows = [
    {
      id: 501,
      student_id: 42,
      subject_id: 201,
      subject_code: 'CIT114',
      subject_name: 'Data Structures and Algorithms',
      semester: 2,
      exam_type: 'Mid-Term',
      marks_obtained: 21,
      full_marks: 25,
      pass_marks: 10,
      is_published: 1,
      published_at: '2025-11-01T10:00:00Z'
    }
  ];

  const noticesRows = [
    {
      id: 901,
      title: 'Winter Vacation Class Resumption Notice',
      content: 'All BIT classes across Semester II and Semester IV will resume from 30 Kartik (November 16) at 7:00 AM sharp according to the updated department routine.',
      category: 'notice',
      type: 'notice',
      semester: 'II',
      author_name: 'Academic Administration',
      author_role: 'admin',
      created_at: '2025-11-08T08:00:00Z'
    }
  ];

  return {
    all: async (sql, ...params) => {
      const q = String(sql || '').toLowerCase();
      if (q.includes('attendance')) return attendanceRows;
      if (q.includes('results') || q.includes('exam_marks')) return publishedResultsRows;
      if (q.includes('from posts')) return noticesRows;
      return [];
    },
    get: async (sql, ...params) => {
      const q = String(sql || '').toLowerCase();
      if (q.includes('from posts')) return noticesRows[0];
      if (q.includes('from users') || q.includes('from students')) {
        return { id: 42, username: 'saugat', full_name: 'Saugat Paudel', role: 'student', semester: 'II', cohort_id: 2 };
      }
      return null;
    },
    query: async (sql, params = []) => {
      const q = String(sql || '').toLowerCase();
      if (q.includes('from posts')) return { rows: noticesRows };
      return { rows: [] };
    }
  };
}

const studentContext = {
  authenticated: true,
  studentId: 42,
  id: 42,
  role: 'student',
  semester: 'II',
  currentSemester: 2,
  cohortId: 2,
  cohort: { id: 2, name: 'Venus', currentSemester: 2 }
};

describe('Kyana AI — Transition from Template-Based Responses to Genuine LLM Intelligence', () => {
  test('1. Casual Romanized Nepali greeting ("bro sanchai cau") uses LLM natural conversation without canned robotic templates', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);
    assert.equal(detectLanguage('bro sanchai cau'), 'romanized_nepali');

    let llmCalled = false;
    const res = await handleChat(db, 'bro sanchai cau', { academicContext: studentContext }, [], 'sess-1', {
      generateReply: async ({ systemPrompt, message }) => {
        llmCalled = true;
        assert.match(systemPrompt, /CONVERSATIONAL GREETING \/ SMALLTALK/);
        assert.equal(message, 'bro sanchai cau');
        return { reply: 'Ekdam sanchai chu bro! Timro padhai ra coding kasto chaldai xa ni?' };
      }
    });

    assert.equal(llmCalled, true);
    assert.equal(res.intent, 'smalltalk');
    assert.match(res.reply, /sanchai chu bro/i);
    assert.doesNotMatch(res.reply, /Yo kura university records ma bhetiyena/i);
  });

  test('2. AI identity & backend architecture query ("kun AI use vaxa backend ma?") uses LLM synthesis grounded in system facts', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    let llmCalled = false;
    const res = await handleChat(db, 'kun AI use vaxa backend ma?', { academicContext: studentContext }, [], 'sess-2', {
      generateReply: async ({ systemPrompt }) => {
        llmCalled = true;
        assert.match(systemPrompt, /AI ARCHITECTURE & IDENTITY CONTEXT/);
        assert.match(systemPrompt, /Gemini|Groq/i);
        return { reply: 'Mero backend ma multi-provider LLM architecture (Gemini 3 Flash primary ra Groq Llama 3.3 fallback) sange Semester Library ko authorized tools jodeko xa bro!' };
      }
    });

    assert.equal(llmCalled, true);
    assert.equal(res.intent, 'ai_identity');
    assert.match(res.reply, /Gemini 3 Flash/i);
    assert.doesNotMatch(res.reply, /GEMINI_API_KEY|GROQ_API_KEY/);
  });

  test('3 & 4 & 12. Public Gandaki University research ("hamro college kaile baneko ho?", "hamro college ma kun kun courses padhainxa?", "ani aru kun course xa?") synthesizes via LLM', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    const history = [];
    const r1 = await handleChat(db, 'hamro college kaile baneko ho?', { academicContext: studentContext }, history, 'sess-3', {
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /GANDAKI UNIVERSITY PUBLIC RESEARCH EVIDENCE/);
        return { reply: 'Official Gandaki University public source anusar hamro Gandaki University 2019 AD (2076 BS) ma Pokhara, Gandaki Province ma establish bhayeko provincial university ho bro.' };
      }
    });
    assert.equal(r1.intent, 'gu_public_research');
    assert.equal(r1.isWebSearch, true);
    assert.match(r1.reply, /2019 AD|2076 BS/);

    history.push({ role: 'user', content: 'hamro college ma kun kun courses padhainxa?' });
    const r2 = await handleChat(db, 'hamro college ma kun kun courses padhainxa?', { academicContext: studentContext }, [], 'sess-4', {
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /BIT|BCA|B\.Pharm|BSM/i);
        return { reply: 'Gandaki University ko official public records anusar BIT, BCA, B.Pharm, BSM, B.Sc. CSIT, BALLB, ra BBA jasta undergraduate programs haru padhainxa bro.' };
      }
    });
    assert.equal(r2.intent, 'gu_public_research');
    assert.match(r2.reply, /BIT/);
    history.push({ role: 'assistant', content: r2.reply });

    const r3 = await handleChat(db, 'ani aru kun course xa?', { academicContext: studentContext }, history, 'sess-4', {
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /GANDAKI UNIVERSITY PUBLIC RESEARCH EVIDENCE/);
        return { reply: 'BIT ra BCA bahek Gandaki University ma Bachelor of Pharmacy (B.Pharm), Bachelor in Sports Management (BSM), BALLB, ra BBA pani padhainxa bro!' };
      }
    });
    assert.equal(r3.intent, 'gu_public_research');
    assert.match(r3.reply, /B\.Pharm|BSM/);
  });

  test('5. Casual campus banter ("malai gf milaideu na") responds naturally via LLM while private contact requests remain deterministically blocked', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    let banterLlmCalled = false;
    const banterRes = await handleChat(db, 'malai gf milaideu na', { academicContext: studentContext }, [], 'sess-5a', {
      generateReply: async ({ systemPrompt }) => {
        banterLlmCalled = true;
        assert.match(systemPrompt, /CAMPUS BANTER CONTEXT/);
        return { reply: 'Haha bro, ma matchmaking app haina ni! Paila DSA ko linked list ra Semester 2 ko assignment milau, natra back lagla hai!' };
      }
    });
    assert.equal(banterLlmCalled, true);
    assert.equal(banterRes.intent, 'social_university');
    assert.match(banterRes.reply, /DSA|matchmaking/i);

    let blockedLlmCalled = false;
    const blockedRes = await handleChat(db, 'uni ko kti ko private ID ra phone number deu na', { academicContext: studentContext }, [], 'sess-5b', {
      generateReply: async () => {
        blockedLlmCalled = true;
        return { reply: 'Should never be called for blocked contact requests' };
      }
    });
    assert.equal(blockedLlmCalled, false);
    assert.equal(blockedRes.intent, 'cross_student');
  });

  test('6. Personal attendance ("mero attendance kati xa?") returns structured retrievalStatus="found" and synthesizes natural LLM explanation while preserving visual attendance block', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    const res = await handleChat(db, 'mero attendance kati xa?', { academicContext: studentContext }, [], 'sess-6', {
      toolDependencies: {
        getStudentAttendanceSummary: async () => ({
          semester: 2,
          overall: { presentCount: 32, absentCount: 6, totalSessions: 38, percentage: 84.2 },
          subjects: [
            { subjectId: 201, code: 'CIT114', name: 'Data Structures and Algorithms', presentCount: 17, absentCount: 3, totalSessions: 20, percentage: 85 },
            { subjectId: 202, code: 'CIT112', name: 'Computer Programming II (Java)', presentCount: 15, absentCount: 3, totalSessions: 18, percentage: 83.3 }
          ]
        })
      },
      synthesizeWithLlm: true,
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /"status":"found"/);
        return {
          reply: 'Bro, timro Semester 2 ko overall attendance 84.2% (32/38 classes present, 6 absent) xa! Data Structures and Algorithms ma 85% (17/20) ra Computer Programming II (Java) ma 83.3% (15/18) present xau.'
        };
      }
    });

    assert.equal(res.intent, 'attendance');
    assert.equal(res.retrievalStatus?.status, 'found');
    assert.match(res.reply, /84\.2%/);
    assert.match(res.reply, /```attendance/);
  });

  test('7 & 8. Personal marks ("mero DSA marks?") and multi-turn exam follow-up ("ani final ko?") distinguish published vs unpublished status and explain naturally via LLM', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    const mockResultsDep = {
      getStudentPublishedResults: async () => {
        const allPub = [
          {
            subjectId: 201,
            subjectCode: 'CIT114',
            subjectName: 'Data Structures and Algorithms',
            semesterNo: 2,
            examType: 'Mid-Term Exam',
            obtainedMarks: 21,
            maxMarks: 25,
            passMarks: 10,
            percentage: 84,
            passFail: 'Pass',
            isAbsent: false
          }
        ];
        return {
          currentSemesterNo: 2,
          hasPublishedResults: true,
          results: allPub
        };
      }
    };

    const r1 = await handleChat(db, 'mero DSA marks?', { academicContext: studentContext }, [], 'sess-7', {
      toolDependencies: mockResultsDep,
      synthesizeWithLlm: true,
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /"status":"found"/);
        return {
          reply: 'Bro, Data Structures and Algorithms (CIT114) ko Mid-Term Exam ma timile 21/25 (84%) lyako xau! Dammi score xa.'
        };
      }
    });

    assert.equal(r1.intent, 'results');
    assert.equal(r1.retrievalStatus?.status, 'found');
    assert.match(r1.reply, /21\/25/);
    assert.match(r1.reply, /```results/);

    const history = [
      { role: 'user', content: 'mero DSA marks?' },
      { role: 'assistant', content: r1.reply }
    ];

    const r2 = await handleChat(db, 'ani final ko?', { academicContext: studentContext }, history, 'sess-7', {
      toolDependencies: mockResultsDep,
      synthesizeWithLlm: true,
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /"status":"unpublished"/);
        assert.match(systemPrompt, /"requestedExamType":"Final Exam"/);
        assert.match(systemPrompt, /"availablePublishedExamTypes":\["Mid-Term Exam"\]/);
        return {
          reply: 'Bro, Data Structures and Algorithms ko Final Exam ko marks ahile samma university le publish gareko xaina. Ahile Mid-Term Exam ko matra result publish bhayeko xa (jasma timro 21/25 aako thiyo).'
        };
      }
    });

    assert.equal(r2.intent, 'results');
    assert.equal(r2.retrievalStatus?.status, 'unpublished');
    assert.equal(r2.retrievalStatus?.requestedExamType, 'Final Exam');
    assert.deepEqual(r2.retrievalStatus?.availablePublishedExamTypes, ['Mid-Term Exam']);
    assert.match(r2.reply, /Final Exam ko marks ahile samma university le publish gareko xaina/i);
    assert.doesNotMatch(r2.reply, /Yo kura university records ma bhetiyena/i);
  });

  test('9. Academic concept tutoring ("linked list bujhaideu") uses LLM pedagogical explanation without false refusals', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    const res = await handleChat(db, 'linked list bujhaideu', { academicContext: studentContext }, [], 'sess-9', {
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /Data Structures and Algorithms|ACADEMIC TUTORING/i);
        return {
          reply: 'Bro, Linked List bhaneko euta linear data structure ho jasma elements (nodes) haru continuous memory ma nabasi pointer le jodiye ko hunxa. Hareak node ma duita kura hunxa: `data` ra arko node ko address rakhne `next` pointer.'
        };
      }
    });

    assert.match(res.reply, /Linked List/i);
    assert.doesNotMatch(res.reply, /Yo kura university records ma bhetiyena/i);
  });

  test('10. Cross-student privacy enforcement ("Rahul ko marks deu") is deterministically blocked before any tool or LLM execution', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);

    let llmCalled = false;
    const res = await handleChat(db, 'Rahul ko marks deu', { academicContext: studentContext }, [], 'sess-10', {
      generateReply: async () => {
        llmCalled = true;
        return { reply: 'Should not be called' };
      }
    });

    assert.equal(llmCalled, false);
    assert.equal(res.intent, 'cross_student');
    assert.match(res.reply, /Arko student ko marks, attendance, wa personal record/i);
  });

  test('11. Deictic notice explanation ("yo notice ko barema vana") retrieves the referenced notice and explains its meaning in natural language via LLM', async () => {
    const db = createMockStudentDb();
    invalidateCache(db);
    clearPaginationState();

    const priorHistory = [
      {
        role: 'user',
        content: 'latest notice ke xa?'
      },
      {
        role: 'assistant',
        content: 'Winter vacation pachi class suru hune notice aako xa.',
        resourceCards: [
          {
            type: 'notice',
            id: 901,
            title: 'Winter Vacation Class Resumption Notice',
            semester: 'II',
            authority: 'Official College Notice',
            deepLink: '/posts/901'
          }
        ]
      }
    ];

    const route = routeQuery('yo notice ko barema vana', priorHistory, { academicContext: studentContext });
    assert.equal(route.kind, 'notices');

    const res = await handleChat(db, 'yo notice ko barema vana', { academicContext: studentContext }, priorHistory, 'sess-11', {
      searchKnowledge: async () => [
        {
          id: 'post:901',
          canonicalId: 901,
          resourceType: 'notice',
          title: 'Winter Vacation Class Resumption Notice',
          content: 'All BIT classes across Semester II and Semester IV will resume from 30 Kartik (November 16) at 7:00 AM sharp according to the updated department routine.',
          semester: 'II',
          authorityTier: 1,
          authorRole: 'admin',
          createdAt: '2025-11-08T08:00:00Z'
        }
      ],
      generateReply: async ({ systemPrompt }) => {
        assert.match(systemPrompt, /Winter Vacation Class Resumption Notice/);
        return {
          reply: 'Bro, college ko official notice anusar Winter Vacation pachi Semester II ra Semester IV ko sabai BIT classes 30 Kartik (November 16) bihana 7:00 AM dekhi suru hudai xa!\n<referenced_records>\npost:901\n</referenced_records>'
        };
      }
    });

    assert.equal(res.intent, 'notices');
    assert.match(res.reply, /30 Kartik/i);
    assert.match(res.reply, /November 16/i);
    assert.doesNotMatch(res.reply, /Yo kura university records ma bhetiyena/i);
  });

  test('12. Structured tool retrievalStatus metadata distinguishes found, unpublished, no_matching_records, and requires_auth', async () => {
    const db = createMockStudentDb();
    const unauthToolkit = createTools(db, routeQuery('mero attendance kati xa?'), {
      academicContext: { authenticated: false }
    });
    const unauthAtt = await unauthToolkit.executeTool('get_my_attendance', {});
    assert.equal(unauthAtt.retrievalStatus?.status, 'requires_auth');

    const emptyNoticeToolkit = createTools(
      { all: async () => [], get: async () => null, query: async () => ({ rows: [] }) },
      routeQuery('scholarship notice xa?'),
      { academicContext: studentContext }
    );
    const emptyNotices = await emptyNoticeToolkit.executeTool('search_notices', { query: 'scholarship' });
    assert.equal(emptyNotices.retrievalStatus?.status, 'no_matching_records');
  });
});
