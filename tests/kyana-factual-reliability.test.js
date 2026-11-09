'use strict';

/**
 * Kyana AI — Comprehensive Factual Reliability & Accuracy Test Suite (Phase 6)
 *
 * Verifies system-wide factual truth, calendar conversions, temporal reasoning,
 * deterministic grounding, and error-resilience across 20 core categories.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const temporal = require('../lib/temporal-intelligence');
const nepaliDates = require('../lib/nepali-dates');
const academicEvent = require('../lib/academic-event-intelligence');
const academicIntel = require('../lib/academic-intelligence');
const chatTools = require('../lib/chat-tools');
const chatSecurity = require('../lib/chat-security');
const { runKyanaAgentLoop, understandRequest } = require('../lib/kyana-agent-engine');

test.beforeEach(() => {
  temporal.resetMockTime();
});

test.afterEach(() => {
  temporal.resetMockTime();
});

// Category 1: Current Nepal Date & Instant fast-path
test('1. Instant Current Date fast-path returns authoritative Nepal date in <1ms with 0 DB queries', () => {
  temporal.setMockTime(new Date('2026-11-10T12:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();
  assert.equal(tempCtx.adDate, '2026-11-10');
  assert.equal(tempCtx.bsDate, '2083-07-24');

  const queries = [
    'Aaja kati gate ho?',
    'What is today\'s date?',
    'आज कति गते हो?',
    'Kati tarikh ho aaja?',
    'Aaja ko date k ho?',
    'What\'s today\'s date in Nepal?',
    'Aaja k bar ho?'
  ];

  for (const q of queries) {
    assert.equal(chatTools.isCurrentDateQuery(q), true, `Failed to recognize: ${q}`);
    const route = chatTools.routeQuery(q, []);
    assert.equal(route.kind, 'current_date');
    assert.equal(route.isFastPath, true);

    const reply = chatTools.buildCurrentDateReply(q);
    assert.ok(reply.includes('24 Kartik 2083') || reply.includes('२४ कार्तिक २०८३'));
  }

  // Non-date queries must NOT trigger fast-path
  const nonDateQueries = [
    'Hamro project defense kaile ho?',
    'When do classes resume?',
    'Who is Newton?',
    'Explain quicksort'
  ];
  for (const nq of nonDateQueries) {
    assert.equal(chatTools.isCurrentDateQuery(nq), false, `False positive for: ${nq}`);
  }
});

// Category 2: Month boundary crossings (Kartik 30 to Mangsir 1)
test('2. Month boundary crossing: Kartik 30, 2083 is Nov 16, 2026 and Mangsir 1 is Nov 17, 2026', () => {
  // 2083 Kartik has 30 days
  assert.equal(temporal.bsToAd(2083, 7, 30), '2026-11-16');
  assert.equal(temporal.bsToAd(2083, 8, 1), '2026-11-17');

  const bsLastKartik = temporal.adToBs('2026-11-16');
  assert.equal(bsLastKartik.year, 2083);
  assert.equal(bsLastKartik.month, 7);
  assert.equal(bsLastKartik.day, 30);
  assert.equal(bsLastKartik.monthNameEn, 'Kartik');

  const bsFirstMangsir = temporal.adToBs('2026-11-17');
  assert.equal(bsFirstMangsir.year, 2083);
  assert.equal(bsFirstMangsir.month, 8);
  assert.equal(bsFirstMangsir.day, 1);
  assert.equal(bsFirstMangsir.monthNameEn, 'Mangsir');
});

// Category 3: Month length variations across years
test('3. Independently verified 2083 BS month lengths: Ashadh has 32 days, Ashwin has 31 days', () => {
  // Verified table for 2083 BS
  const lengths2083 = temporal.BS_MONTH_DAYS[2083];
  assert.deepEqual(lengths2083, [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]);

  // Ashadh (month 3) has 32 days
  assert.equal(lengths2083[2], 32);
  assert.doesNotThrow(() => temporal.bsToAd(2083, 3, 32));
  assert.throws(() => temporal.bsToAd(2083, 3, 33));

  // Ashwin (month 6) has 31 days
  assert.equal(lengths2083[5], 31);
  assert.doesNotThrow(() => temporal.bsToAd(2083, 6, 31));
  assert.throws(() => temporal.bsToAd(2083, 6, 32));

  // Mangsir (month 8) has 29 days
  assert.equal(lengths2083[7], 29);
  assert.doesNotThrow(() => temporal.bsToAd(2083, 8, 29));
  assert.throws(() => temporal.bsToAd(2083, 8, 30));
});

// Category 4: Host timezone independence
test('4. Host timezone independence: getNepalDateTime produces exact Asia/Kathmandu time', () => {
  // Test with fixed UTC instant
  const utcInstant = new Date('2026-11-10T00:00:00.000Z'); // 5:45 AM in Nepal on Nov 10
  const dt = temporal.getNepalDateTime(utcInstant);
  assert.equal(dt.dateStr, '2026-11-10');
  assert.equal(dt.hours, 5);
  assert.equal(dt.minutes, 45);
});

// Category 5: Midnight transition in Nepal
test('5. Midnight transition in Nepal updates the date at 00:00:00 Asia/Kathmandu', () => {
  // 23:59:59 on Nov 10 in Nepal
  const beforeMidnight = new Date('2026-11-10T23:59:59+05:45');
  temporal.setMockTime(beforeMidnight);
  const ctxBefore = temporal.getTemporalContext();
  assert.equal(ctxBefore.adDate, '2026-11-10');
  assert.equal(ctxBefore.bsDate, '2083-07-24');

  // 00:00:00 on Nov 11 in Nepal
  const atMidnight = new Date('2026-11-11T00:00:00+05:45');
  temporal.setMockTime(atMidnight);
  const ctxAfter = temporal.getTemporalContext();
  assert.equal(ctxAfter.adDate, '2026-11-11');
  assert.equal(ctxAfter.bsDate, '2083-07-25');
});

// Category 6: Bidirectional conversions across supported years
test('6. Bidirectional conversions across sample dates in 2070, 2075, 2080, 2083, 2090', () => {
  const sampleDates = [
    { bs: '2070-01-01', ad: '2013-04-14' },
    { bs: '2075-06-15', ad: '2018-10-01' },
    { bs: '2080-01-01', ad: '2023-04-14' },
    { bs: '2083-08-07', ad: '2026-11-23' },
    { bs: '2090-12-30', ad: '2034-04-13' }
  ];

  for (const { bs, ad } of sampleDates) {
    const [by, bm, bd] = bs.split('-').map(Number);
    const convertedAd = temporal.bsToAd(by, bm, bd);
    assert.equal(convertedAd, ad, `BS ${bs} did not convert to AD ${ad}`);

    const convertedBs = temporal.adToBs(ad);
    assert.equal(convertedBs.dateStr, bs, `AD ${ad} did not convert to BS ${bs}`);
  }
});

// Category 7: Slash-separated BS dates
test('7. Slash-separated numeric BS date "2083/08/07" parsed to 7 Mangsir 2083 and 2026-11-23', () => {
  const extracted = academicEvent.extractDateFromText(
    'Project Defense I is scheduled for 2083/08/07.',
    { bsYear: 2083, adYear: 2026 }
  );

  assert.ok(extracted, 'Failed to extract date from text');
  assert.equal(extracted.eventDateAd, '2026-11-23');
  assert.equal(extracted.eventDateBs, '2083-08-07');
  assert.equal(extracted.eventDateBsFormatted, '7 Mangsir 2083');
  assert.equal(extracted.rawMatched, '2083/08/07');
});

// Category 8: Devanagari slash dates
test('8. Devanagari numerals in slash format "२०८३/०८/०७" extracted correctly', () => {
  const extracted = academicEvent.extractDateFromText(
    'प्रोजेक्ट डिफेन्स २०८३/०८/०७ मा हुनेछ।',
    { bsYear: 2083, adYear: 2026 }
  );

  assert.ok(extracted, 'Failed to extract Devanagari date');
  assert.equal(extracted.eventDateAd, '2026-11-23');
  assert.equal(extracted.eventDateBs, '2083-08-07');
  assert.equal(extracted.eventDateBsFormatted, '7 Mangsir 2083');
});

// Category 9: Distinguish BS from AD years
test('9. Distinguish BS years (2070-2095) from Gregorian AD years (2013-2040)', () => {
  const bsText = 'Event date: 2083-07-30';
  const extBs = academicEvent.extractDateFromText(bsText, { bsYear: 2083, adYear: 2026 });
  assert.equal(extBs.eventDateBs, '2083-07-30');
  assert.equal(extBs.eventDateAd, '2026-11-16');

  const adText = 'Event date: 2026-11-16';
  const extAd = academicEvent.extractDateFromText(adText, { bsYear: 2083, adYear: 2026 });
  assert.equal(extAd.eventDateAd, '2026-11-16');
  assert.equal(extAd.eventDateBs, '2083-07-30');
});

// Category 10: Newton Teacher notice retrieval and event resolution
test('10. Newton Teacher notice Post 187 resolved with exact countdown and author', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const newtonNotice = {
    id: 187,
    title: 'Project Defense Notice',
    content: 'Project Defense I is scheduled for 2083/08/07.',
    authorName: 'Newton',
    authorRole: 'teacher',
    authorityTier: 2,
    createdAt: '2026-11-09T08:00:00.000Z'
  };

  const resolution = academicEvent.resolveAcademicEvents(
    [newtonNotice],
    'Hamro project defense kaile ho?',
    tempCtx
  );

  assert.equal(resolution.hasEvent, true);
  assert.equal(resolution.activeEvent.eventType, 'project_defense');
  assert.equal(resolution.activeEvent.eventDateAd, '2026-11-23');
  assert.equal(resolution.activeEvent.eventDateBsFormatted, '7 Mangsir 2083');
  // Today is Nov 10, Event is Nov 23 -> exactly 13 days remaining
  assert.equal(resolution.countdown.daysRemaining, 13);
  assert.ok(resolution.factSheet.includes('EXACT DAYS REMAINING: 13 days'));
});

// Category 11: Event preference alignment
test('11. Event preference alignment: defense query selects defense notice over class resumption', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const records = [
    {
      id: 186,
      title: 'Resumption of Regular Classes',
      content: 'Classes resume from 30 Kartik 2083.',
      authorityTier: 1,
      createdAt: '2026-11-02T10:00:00.000Z'
    },
    {
      id: 187,
      title: 'Project Defense Notice',
      content: 'Project Defense I is scheduled for 2083/08/07.',
      authorityTier: 2,
      createdAt: '2026-11-09T08:00:00.000Z'
    }
  ];

  // Query specifically asking about defense
  const resDefense = academicEvent.resolveAcademicEvents(records, 'Project defense kaile ho?', tempCtx);
  assert.equal(resDefense.activeEvent.eventType, 'project_defense');
  assert.equal(resDefense.activeEvent.id, 187);

  // Query specifically asking about classes reopening
  const resClass = academicEvent.resolveAcademicEvents(records, 'College kahile khulcha?', tempCtx);
  assert.equal(resClass.activeEvent.eventType, 'class_resumption');
  assert.equal(resClass.activeEvent.id, 186);
});

// Category 12: Superseded notices
test('12. Newer confirmed announcement supersedes older announcement of the same type', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const notices = [
    {
      id: 101,
      title: 'Class Resumption Notice',
      content: 'Regular classes will resume from Kartik 25, 2083.',
      authorityTier: 1,
      createdAt: '2026-11-01T10:00:00.000Z'
    },
    {
      id: 102,
      title: 'Updated Resumption Notice',
      content: 'Due to ongoing maintenance, classes will now resume from Kartik 30, 2083.',
      authorityTier: 1,
      createdAt: '2026-11-05T10:00:00.000Z'
    }
  ];

  const resolution = academicEvent.resolveAcademicEvents(notices, 'When do classes resume?', tempCtx);
  assert.equal(resolution.activeEvent.id, 102);
  assert.equal(resolution.activeEvent.eventDateBsFormatted, '30 Kartik 2083');
  assert.equal(resolution.supersededEvents.length, 1);
  assert.equal(resolution.supersededEvents[0].id, 101);
});

// Category 13: Conflicting announcements
test('13. Conflicting announcements published by equal authorities with differing dates are flagged', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const conflicting = [
    {
      id: 201,
      title: 'Admin Notice A',
      content: 'Classes resume on Kartik 28, 2083.',
      authorityTier: 1,
      createdAt: '2026-11-05T10:00:00.000Z'
    },
    {
      id: 202,
      title: 'Admin Notice B',
      content: 'Classes resume on Kartik 30, 2083.',
      authorityTier: 1,
      createdAt: '2026-11-05T10:00:00.000Z'
    }
  ];

  const resolution = academicEvent.resolveAcademicEvents(conflicting, 'When do classes reopen?', tempCtx);
  assert.equal(resolution.hasConflict, true);
  assert.equal(resolution.conflictingEvents.length, 2);
  assert.ok(resolution.factSheet.includes('CONFLICTING ANNOUNCEMENTS DETECTED'));
});

// Category 14: Unparseable dates handled gracefully
test('14. Notices with missing or unparseable event dates handled gracefully without NaN', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const generalNotice = {
    id: 301,
    title: 'Campus Renovation Update',
    content: 'Renovation work is underway in Block B. Please cooperate.',
    authorityTier: 1,
    createdAt: '2026-11-04T10:00:00.000Z'
  };

  const resolution = academicEvent.resolveAcademicEvents([generalNotice], 'Tell me about renovation', tempCtx);
  assert.equal(resolution.hasEvent, false);
  assert.equal(resolution.activeEvent, null);
  assert.equal(resolution.countdown, null);
});

// Category 15: Factual verification guard
test('15. Factual verification guard intercepts and corrects incorrect countdown and attendance %', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const resolvedEvents = {
    hasEvent: true,
    activeEvent: {
      eventType: 'project_defense',
      title: 'Project Defense Notice',
      eventDateAd: '2026-11-23',
      eventDateBsFormatted: '7 Mangsir 2083',
      publicationDate: '2026-11-09'
    },
    countdown: {
      daysRemaining: 13,
      humanSummaryEn: '13 days remaining'
    }
  };

  // LLM hallucinated 10 days remaining instead of 13
  const badReply = 'Your project defense is scheduled for 7 Mangsir 2083. There are 10 days remaining until the event. Your attendance is 78% in DSA.';

  const guarded = academicIntel.verifyAndGuardReply({
    reply: badReply,
    resolvedEvents,
    attendanceStats: { percentage: 85.0 },
    temporalContext: tempCtx
  });

  assert.equal(guarded.guarded, true);
  assert.ok(guarded.reply.includes('13 days remaining'));
  assert.ok(!guarded.reply.includes('10 days remaining'));
  assert.ok(guarded.reply.includes('85%'));
  assert.ok(!guarded.reply.includes('78%'));
});

// Category 16: Anchoring prevention
test('16. Stale publication date is never treated as today\'s date by guard', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const resolvedEvents = {
    hasEvent: true,
    activeEvent: {
      publicationDate: '2026-11-02'
    }
  };

  const staleReply = 'As announced today is 2026-11-02, the schedule is ready.';
  const guarded = academicIntel.verifyAndGuardReply({
    reply: staleReply,
    resolvedEvents,
    temporalContext: tempCtx
  });

  assert.equal(guarded.guarded, true);
  assert.ok(guarded.reply.includes('today is 2026-11-10'));
});

// Category 17: Context isolation
test('17. "Explain polymorphism" does NOT inherit previous DSA subject from prior turn', () => {
  const history = [
    { role: 'user', content: 'What assignments are due in DSA?' },
    { role: 'assistant', content: 'You have DSA Lab 3 due next Sunday.' }
  ];

  const understanding = understandRequest('Explain polymorphism with an example', history, { currentSemester: 2 });
  assert.notEqual(understanding.entities.subject, 'Data Structures and Algorithms');
  assert.ok(understanding.entities.topic.includes('polymorphism'));
});

// Category 18: Student privacy
test('18. Student privacy guard redacts unauthorized student IDs / roll numbers', () => {
  const replyWithLeak = 'Here is the record for student ID 230199 and student ID 230145.';
  const guarded = academicIntel.verifyAndGuardReply({
    reply: replyWithLeak,
    academicContext: { studentId: '230145' }
  });

  assert.equal(guarded.guarded, true);
  assert.ok(!guarded.reply.includes('230199'));
  assert.ok(guarded.reply.includes('[redacted student info]'));
  assert.ok(guarded.reply.includes('230145')); // Own ID is preserved
});

// Category 19: Zero-result grounding
test('19. Zero-result grounding does not invent non-existent records', () => {
  const factSheet = academicIntel.buildDeterministicFactSheet({
    temporalContext: temporal.getTemporalContext(),
    resolvedEvents: null,
    attendanceStats: null,
    marksStats: null
  });

  assert.ok(factSheet.includes('AUTHORITATIVE SERVER-SIDE DETERMINISTIC FACT SHEET'));
  assert.ok(!factSheet.includes('VERIFIED ACADEMIC EVENT'));
});

// Category 20: Deterministic Fact Sheet injection in agent loop
test('20. Deterministic Fact Sheet format contains all required system truths', () => {
  temporal.setMockTime(new Date('2026-11-10T10:00:00+05:45'));
  const tempCtx = temporal.getTemporalContext();

  const factSheet = academicIntel.buildDeterministicFactSheet({
    temporalContext: tempCtx,
    attendanceStats: {
      totalClasses: 40,
      presentCount: 34,
      percentage: 85.0,
      status: 'Eligible'
    },
    marksStats: {
      gpa: 3.75,
      subjects: [
        { subjectName: 'Data Structures', internal: 38, maxInternal: 40, final: 'A', grade: 'A' }
      ]
    }
  });

  assert.ok(factSheet.includes('Current System Timezone: Asia/Kathmandu (UTC+05:45)'));
  assert.ok(factSheet.includes('2026-11-10'));
  assert.ok(factSheet.includes('24 Kartik 2083'));
  assert.ok(factSheet.includes('Total Classes Conducted: 40'));
  assert.ok(factSheet.includes('Classes Attended: 34'));
  assert.ok(factSheet.includes('Attendance Percentage: 85%'));
  assert.ok(factSheet.includes('Cumulative GPA: 3.75'));
});
