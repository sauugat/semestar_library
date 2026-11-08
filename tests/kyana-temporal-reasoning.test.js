'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const temporal = require('../lib/temporal-intelligence');
const {
  setMockTime,
  resetMockTime,
  getNow,
  getNepalDateTime,
  formatNepalDate,
  adToBs,
  bsToAd,
  calculateDaysBetween,
  calculateDaysRemaining,
  calculateDaysElapsed,
  getTemporalContext,
  calculateEventCountdown
} = temporal;

const academicEvent = require('../lib/academic-event-intelligence');
const {
  resolveAcademicEvents,
  extractEventFromRecord,
  evaluateEventSupersessionAndConflicts
} = academicEvent;

const academicIntel = require('../lib/academic-intelligence');
const {
  classifyAcademicQuestion,
  buildDeterministicFactSheet,
  verifyAndGuardReply,
  INTENTS
} = academicIntel;

const { handleChat } = require('../ai-assistant');

const prevV3 = process.env.KYANA_KNOWLEDGE_V3;
const prevV3Users = process.env.KYANA_KNOWLEDGE_V3_USERS;

test.beforeEach(() => {
  resetMockTime();
  process.env.KYANA_KNOWLEDGE_V3 = 'true';
  process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
});

test.afterEach(() => {
  resetMockTime();
  process.env.KYANA_KNOWLEDGE_V3 = prevV3;
  process.env.KYANA_KNOWLEDGE_V3_USERS = prevV3Users;
});

// 1. Current date changes without restarting the server
test('1. Current date changes dynamically without restarting the server (setMockTime)', () => {
  // First mock date: Nov 8, 2026
  setMockTime('2026-11-08T10:00:00+05:45');
  let ctx = getTemporalContext();
  assert.equal(ctx.adDate, '2026-11-08');
  assert.equal(ctx.bsFormattedEn, '22 Kartik 2083');

  // Change date dynamically to Dec 1, 2026 without server restart
  setMockTime('2026-12-01T15:30:00+05:45');
  ctx = getTemporalContext();
  assert.equal(ctx.adDate, '2026-12-01');
  assert.equal(ctx.bsYear, 2083);
  assert.equal(ctx.bsMonthName, 'Mangsir');

  // Reset to live system clock
  resetMockTime();
  assert.equal(temporal.isMockTimeActive(), false);
});

// 2. Asia/Kathmandu timezone boundaries
test('2. Asia/Kathmandu timezone boundaries and midnight transition', () => {
  // 1 second before midnight on Nov 8, 2026 in Asia/Kathmandu (UTC+05:45)
  setMockTime('2026-11-08T23:59:59+05:45');
  const beforeMidnight = getNepalDateTime();
  assert.equal(beforeMidnight.dateStr, '2026-11-08');
  assert.equal(beforeMidnight.dayOfWeek, 'Sunday');

  const beforeBs = adToBs(beforeMidnight.dateStr);
  assert.equal(beforeBs.day, 22);
  assert.equal(beforeBs.monthNameEn, 'Kartik');

  // 1 second after midnight -> crossing into Nov 9, 2026
  setMockTime('2026-11-09T00:00:01+05:45');
  const afterMidnight = getNepalDateTime();
  assert.equal(afterMidnight.dateStr, '2026-11-09');
  assert.equal(afterMidnight.dayOfWeek, 'Monday');

  const afterBs = adToBs(afterMidnight.dateStr);
  assert.equal(afterBs.day, 23);
  assert.equal(afterBs.monthNameEn, 'Kartik');
});

// 3. Gregorian / Bikram Sambat two-way conversion
test('3. Gregorian / Bikram Sambat bidirectional two-way conversion', () => {
  // 2083 Kartik 22 BS = 2026-11-08 AD
  const ad1 = bsToAd(2083, 7, 22);
  assert.equal(ad1, '2026-11-08');
  const bs1 = adToBs('2026-11-08');
  assert.equal(bs1.year, 2083);
  assert.equal(bs1.month, 7);
  assert.equal(bs1.day, 22);
  assert.equal(bs1.monthNameEn, 'Kartik');
  assert.equal(bs1.formattedEn, '22 Kartik 2083');

  // 2083 Kartik 30 BS = 2026-11-16 AD
  const ad2 = bsToAd(2083, 7, 30);
  assert.equal(ad2, '2026-11-16');
  const bs2 = adToBs('2026-11-16');
  assert.equal(bs2.year, 2083);
  assert.equal(bs2.month, 7);
  assert.equal(bs2.day, 30);
  assert.equal(bs2.monthNameEn, 'Kartik');
  assert.equal(bs2.formattedEn, '30 Kartik 2083');

  // New Year: 2083 Baishakh 1 BS = 2026-04-14 AD
  const adNy = bsToAd(2083, 1, 1);
  assert.equal(adNy, '2026-04-14');
  const bsNy = adToBs('2026-04-14');
  assert.equal(bsNy.year, 2083);
  assert.equal(bsNy.month, 1);
  assert.equal(bsNy.day, 1);
});

// 4. Days remaining until class resumption (Reproduce the exact Nov 8, 2026 example -> 8 days)
test('4. Reproduce exact Nov 8, 2026 example: exactly 8 days remaining until Nov 16, 2026 (30 Kartik 2083)', async () => {
  // Current date: November 8, 2026
  setMockTime('2026-11-08T10:00:00+05:45');
  const tempCtx = getTemporalContext();
  assert.equal(tempCtx.adDate, '2026-11-08');
  assert.equal(tempCtx.bsFormattedEn, '22 Kartik 2083');

  const records = [
    {
      id: 'notice:101',
      canonicalId: 101,
      resourceType: 'notice',
      title: 'Tihar & Chhath Vacation Extension Notice',
      content: 'All BIT classes will officially resume from 30 Kartik 2083 (November 16, 2026).',
      created_at: '2026-11-05T08:00:00Z', // Published on Nov 5
      authorityTier: 1
    }
  ];

  const resolution = resolveAcademicEvents(records, 'When do classes resume and how many days are left?', tempCtx);
  assert.equal(resolution.hasEvent, true);
  assert.equal(resolution.activeEvent.eventDateAd, '2026-11-16');
  assert.equal(resolution.activeEvent.eventDateBsFormatted, '30 Kartik 2083');

  // DETERMINISTIC RESULT: Nov 16 minus Nov 8 = EXACTLY 8 DAYS!
  assert.equal(resolution.countdown.daysRemaining, 8);
  assert.match(resolution.countdown.humanSummaryEn, /8 days remaining/);

  // Now test full handleChat knowledge retrieval pipeline with mock LLM generator
  let capturedPrompt = '';
  const mockDb = {
    isPostgres: false,
    async get(sql, id) {
      if (String(sql).includes('FROM posts')) {
        return {
          id: 101,
          title: 'Tihar & Chhath Vacation Extension Notice',
          type: 'notice',
          audience_scope: 'all_students',
          target_all_semesters: 1
        };
      }
      return null;
    },
    async all() { return []; },
    async run() { return {}; }
  };

  const chatRes = await handleChat(mockDb, 'When do classes resume and how many days are left?', {
    searchKnowledge: async () => records,
    academicContext: { authenticated: true, studentId: '2022-BIT-01', semester: 3, role: 'student' },
    generateReply: async ({ systemPrompt }) => {
      capturedPrompt = systemPrompt;
      // LLM incorporates the fact sheet facts
      return {
        reply: 'According to the official college notice, classes will resume on 30 Kartik 2083 (November 16, 2026). There are 8 days remaining from today.\n<referenced_records>\nnotice:101\n</referenced_records>'
      };
    }
  }, [], 'session_resumption_test');

  assert.ok(capturedPrompt.includes('2026-11-08'), 'Prompt must contain current server date Nov 8, 2026');
  assert.ok(capturedPrompt.includes('8 days'), 'Prompt must contain deterministic 8 days calculation');
  assert.match(chatRes.reply, /8 days remaining/);
  assert.doesNotMatch(chatRes.reply, /11 days/);
});

// 5. Old notices superseded by newer notices
test('5. Old notices superseded by newer confirmed notices', () => {
  setMockTime('2026-11-08T12:00:00+05:45');
  const tempCtx = getTemporalContext();

  const records = [
    {
      id: 'notice:older',
      canonicalId: 1,
      resourceType: 'notice',
      title: 'Preliminary Vacation Schedule',
      content: 'Classes are scheduled to resume on 25 Kartik 2083.',
      created_at: '2026-10-20T10:00:00Z',
      authorityTier: 1
    },
    {
      id: 'notice:newer',
      canonicalId: 2,
      resourceType: 'notice',
      title: 'Official Vacation Extension Notice',
      content: 'Classes will now resume from 30 Kartik 2083 due to extended festival holidays.',
      created_at: '2026-11-05T10:00:00Z',
      authorityTier: 1
    }
  ];

  const resolution = resolveAcademicEvents(records, 'College kahile khulcha?', tempCtx);
  assert.equal(resolution.hasEvent, true);
  // Newer notice wins
  assert.equal(resolution.activeEvent.id, 'notice:newer');
  assert.equal(resolution.activeEvent.eventDateBsFormatted, '30 Kartik 2083');
  assert.equal(resolution.countdown.daysRemaining, 8);

  // Older notice is marked as superseded
  assert.equal(resolution.supersededEvents.length, 1);
  assert.equal(resolution.supersededEvents[0].id, 'notice:older');
  assert.equal(resolution.supersededEvents[0].isSuperseded, true);
});

// 6. Conflicting academic announcements detected
test('6. Conflicting academic announcements from equal authorities are detected and flagged', () => {
  setMockTime('2026-11-08T12:00:00+05:45');
  const tempCtx = getTemporalContext();

  const records = [
    {
      id: 'notice:conflict_a',
      canonicalId: 10,
      resourceType: 'notice',
      title: 'Notice from Admin Office A',
      content: 'Classes resume on 25 Kartik 2083.',
      created_at: '2026-11-05T10:00:00Z',
      authorityTier: 1
    },
    {
      id: 'notice:conflict_b',
      canonicalId: 11,
      resourceType: 'notice',
      title: 'Notice from Examination Board B',
      content: 'Classes resume on 30 Kartik 2083.',
      created_at: '2026-11-05T10:00:00Z', // Same publication date, conflicting target dates
      authorityTier: 1
    }
  ];

  const resolution = resolveAcademicEvents(records, 'When do classes reopen?', tempCtx);
  assert.equal(resolution.hasConflict, true);
  assert.equal(resolution.conflictingEvents.length, 2);
  assert.ok(resolution.factSheet.includes('CONFLICTING ANNOUNCEMENTS DETECTED'));
});

// 7. Missing event dates handled gracefully
test('7. Missing or unparseable event dates handled gracefully without crashing', () => {
  setMockTime('2026-11-08T12:00:00+05:45');
  const tempCtx = getTemporalContext();

  const records = [
    {
      id: 'notice:general',
      canonicalId: 20,
      resourceType: 'notice',
      title: 'Library Renovation',
      content: 'The campus library 2nd floor is being painted this weekend.',
      created_at: '2026-11-04T10:00:00Z',
      authorityTier: 1
    }
  ];

  const resolution = resolveAcademicEvents(records, 'When is renovation complete?', tempCtx);
  assert.equal(resolution.hasEvent, false);
  assert.equal(resolution.countdown, null);
  assert.equal(resolution.hasConflict, false);
});

// 8. Incorrect LLM-generated date calculations intercepted and corrected by post-generation guard
test('8. Post-generation guard intercepts and corrects incorrect LLM date arithmetic (11 days -> 8 days)', () => {
  setMockTime('2026-11-08T12:00:00+05:45');
  const tempCtx = getTemporalContext();

  const resolvedEvents = {
    hasEvent: true,
    activeEvent: {
      eventType: 'class_resumption',
      title: 'College Notice',
      eventDateAd: '2026-11-16',
      eventDateBsFormatted: '30 Kartik 2083',
      publicationDate: '2026-11-05'
    },
    countdown: {
      daysRemaining: 8,
      humanSummaryEn: '8 days remaining'
    }
  };

  // Scenario: LLM hallucinates 11 days (calculating from Nov 5 publication date instead of today Nov 8)
  const flawedReplyEn = 'Classes will resume on 30 Kartik 2083 (November 16, 2026). There are 11 days remaining until classes start.';
  const guardedEn = verifyAndGuardReply({
    reply: flawedReplyEn,
    resolvedEvents,
    temporalContext: tempCtx
  });

  assert.equal(guardedEn.guarded, true);
  assert.equal(guardedEn.reply, 'Classes will resume on 30 Kartik 2083 (November 16, 2026). There are 8 days remaining until classes start.');

  // Scenario Nepali: "११ दिन बाँकी" -> "८ दिन बाँकी"
  const flawedReplyNe = 'कक्षा ३० कार्तिक २०८३ बाट खुल्नेछ। आजबाट ११ दिन बाँकी छ।';
  const guardedNe = verifyAndGuardReply({
    reply: flawedReplyNe,
    resolvedEvents,
    temporalContext: tempCtx
  });

  assert.equal(guardedNe.guarded, true);
  assert.ok(guardedNe.reply.includes('८ दिन बाँकी'));
});

// 9. Stale conversation context anchoring prevention
test('9. Stale conversation context does not override current authoritative date', async () => {
  // Today is Nov 8, 2026
  setMockTime('2026-11-08T12:00:00+05:45');

  // Prior conversation history from 3 days ago (Nov 5, 2026)
  const staleHistory = [
    { role: 'user', content: 'What is today date?' },
    { role: 'assistant', content: 'Today is November 5, 2026 (19 Kartik 2083).' }
  ];

  let systemPromptReceived = '';
  await handleChat(null, 'What is today date and when is class?', {
    generateReply: async ({ systemPrompt }) => {
      systemPromptReceived = systemPrompt;
      return { reply: 'Today is Sunday, November 8, 2026 AD (22 Kartik 2083 BS).' };
    }
  }, staleHistory, 'session_stale_history');

  assert.ok(systemPromptReceived.includes('2026-11-08'), 'Authoritative prompt must reflect current date Nov 8, 2026, not stale Nov 5');
});

// 10. Student-specific data privacy enforcement
test('10. Student-specific data privacy guard redacts unauthorized roll numbers/IDs', () => {
  const currentStudent = { studentId: '2022-BIT-01', role: 'student' };

  // Reply accidentally containing another student's ID
  const leakedReply = 'Your exam marks are recorded under Student ID: 2022-BIT-99 with internal score 19/20.';
  const guarded = verifyAndGuardReply({
    reply: leakedReply,
    academicContext: currentStudent
  });

  assert.equal(guarded.guarded, true);
  assert.doesNotMatch(guarded.reply, /2022-BIT-99/);
  assert.match(guarded.reply, /\[redacted student info\]/);
});

// 11. Academic questions with missing university notes fallback to tutoring
test('11. Academic question with missing university notes tutors student instead of refusing', async () => {
  let capturedPrompt = '';
  const chatRes = await handleChat(null, 'What is session and cookies management in web applications?', {
    searchKnowledge: async () => [], // No notes or files in database
    generateReply: async ({ systemPrompt }) => {
      capturedPrompt = systemPrompt;
      return {
        reply: 'In web development, cookies are stored in the client browser, while sessions maintain state securely on the server.'
      };
    }
  }, [], 'session_tutoring_test');

  // Should NOT refuse with "Semester Library ma vetiyena"
  assert.doesNotMatch(chatRes.reply, /couldn’t find any notices/i);
  assert.doesNotMatch(chatRes.reply, /vetiyena/i);
  assert.match(chatRes.reply, /cookies/i);
  assert.match(chatRes.reply, /sessions/i);
});

// 12. Web and React Native response schema consistency
test('12. Web and React Native response structure is complete and consistent', async () => {
  setMockTime('2026-11-08T12:00:00+05:45');

  const records = [
    {
      id: 'notice:200',
      canonicalId: 200,
      resourceType: 'notice',
      title: 'Exam Routine Notice',
      content: 'Semester exams commence from 15 Mangsir 2083.',
      created_at: '2026-11-07T00:00:00Z',
      authorityTier: 1
    }
  ];

  const mockDb = {
    isPostgres: false,
    async get(sql, id) {
      if (String(sql).includes('FROM posts')) {
        return {
          id: 200,
          title: 'Exam Routine Notice',
          type: 'notice',
          audience_scope: 'all_students',
          target_all_semesters: 1
        };
      }
      return null;
    },
    async all() { return []; },
    async run() { return {}; }
  };

  const res = await handleChat(mockDb, 'Exam routine notice aako xa?', {
    searchKnowledge: async () => records,
    academicContext: { authenticated: true, studentId: '2022-BIT-01', semester: 3, role: 'student' },
    generateReply: async () => ({
      reply: 'Per the official notice, exams start from 15 Mangsir 2083.\n<referenced_records>\nnotice:200\n</referenced_records>'
    })
  }, [], 'session_schema_test');

  // Verify all contract fields expected by web (public/chatbot.js) and mobile (PostMarkdown.tsx / kyana.tsx)
  assert.ok(typeof res.reply === 'string', 'reply must be string');
  assert.ok(Array.isArray(res.resourceCards), 'resourceCards must be array');
  assert.ok(Array.isArray(res.evidenceReferences), 'evidenceReferences must be array');
  assert.ok(typeof res.intent === 'string', 'intent must be string');

  if (res.resourceCards.length > 0) {
    const card = res.resourceCards[0];
    assert.equal(typeof card.id, 'number');
    assert.equal(typeof card.title, 'string');
    assert.equal(typeof card.action, 'string');
    assert.ok(card.deepLink, 'Card must have web deepLink');
    assert.ok(card.mobileRoute, 'Card must have mobileRoute for React Native');
  }
});
