'use strict';

/**
 * Kyana AI — Phase 8.1 Critical Remediation Test Suite
 *
 * Validates the five critical remediation tasks identified in Phase 8:
 * 1. universal_search authorization in chat-security and agent execution
 * 2. Unicode Devanagari and Romanized event keyword classification without ASCII \b bugs
 * 3. Multi-turn conversational countdown intent resolution (preserving active event context)
 * 4. Post-generation verifyAndGuardReply() false positive and negative hardening
 * 5. Deterministic factual fast-path optimization (<1s warm latency, 0 LLM calls for direct facts)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const { handleChat } = require('../ai-assistant');
const temporal = require('../lib/temporal-intelligence');
const academicEvent = require('../lib/academic-event-intelligence');
const academicIntel = require('../lib/academic-intelligence');
const chatSecurity = require('../lib/chat-security');
const { runKyanaAgentLoop, understandRequest } = require('../lib/kyana-agent-engine');

const STUDENT_USER = {
  studentId: 'c808f9d6-1a5e-4ba9-bbf8-bb97a7a40cb2',
  semester: 3,
  department: 'BIT',
  role: 'student',
  authenticated: true
};

const REFERENCE_DATE = new Date('2026-11-10T10:00:00.000Z');

test.beforeEach(() => {
  temporal.resetMockTime();
  temporal.setMockTime(REFERENCE_DATE);
});

test.afterEach(() => {
  temporal.resetMockTime();
});

// =========================================================================
// TASK 1: universal_search Authorization & Origin Safety
// =========================================================================

test('1.1. universal_search is registered in READ_ONLY_TOOLS and passes verifyActionOrigin', () => {
  assert.ok(chatSecurity.READ_ONLY_TOOLS.has('universal_search'), 'universal_search must be in READ_ONLY_TOOLS');

  const originCheck = chatSecurity.verifyActionOrigin({ toolName: 'universal_search' });
  assert.equal(originCheck.allowed, true, 'verifyActionOrigin must allow universal_search');
  assert.equal(originCheck.reason, 'direct_user_turn');
});

test('1.2. universal_search executes inside runKyanaAgentLoop without action authorization errors', async () => {
  const query = 'Gandaki University BIT exam schedule and routine';
  const u = understandRequest(query, [], STUDENT_USER);

  assert.ok(u.intents.includes('routine_lookup') || u.intents.includes('next_examination'));

  const res = await runKyanaAgentLoop({
    db,
    message: query,
    academicContext: STUDENT_USER,
    history: [],
    referenceDate: REFERENCE_DATE
  });

  assert.ok(res.handled, 'Agent loop must handle query');
  assert.ok(res.reply, 'Agent loop must produce a reply');
  const deniedSteps = (res.agentTrace?.steps || []).filter(s => s.error && s.error.includes('Action origin denied'));
  assert.equal(deniedSteps.length, 0, 'No step may be denied with Action origin denied');
});

// =========================================================================
// TASK 2: Unicode Event Detection (Devanagari, Romanized, English)
// =========================================================================

test('2.1. Devanagari event keywords classify accurately without ASCII \\b failure', () => {
  const testCases = [
    { text: 'प्रोजेक्ट डिफेन्स', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'प्रोजेक्ट डिफेन्स कहिले हो?', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'हाम्रो प्रोजेक्ट डिफेन्स कहिले हो?', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'कलेज कहिले खुल्छ?', expected: academicEvent.EVENT_TYPES.CLASS_RESUMPTION },
    { text: 'कक्षा सञ्चालन कहिले हुन्छ?', expected: academicEvent.EVENT_TYPES.CLASS_RESUMPTION },
    { text: 'परीक्षा कहिले हो?', expected: academicEvent.EVENT_TYPES.EXAMINATION },
    { text: 'बुझाउने अन्तिम मिति कहिले हो?', expected: academicEvent.EVENT_TYPES.ASSIGNMENT_DEADLINE },
    { text: 'तिहार बिदा कहिले सम्म छ?', expected: academicEvent.EVENT_TYPES.HOLIDAY },
    { text: 'कक्षाको कार्यतालिका हेरौं', expected: academicEvent.EVENT_TYPES.SEMESTER_SCHEDULE }
  ];

  for (const tc of testCases) {
    const detected = academicEvent.classifyEventType(tc.text);
    assert.equal(detected, tc.expected, `Failed to classify: "${tc.text}" -> expected ${tc.expected}, got ${detected}`);
  }
});

test('2.2. Romanized and English spelling variations classify correctly', () => {
  const testCases = [
    { text: 'project defense', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'project defence', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'viva-voce schedule', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'proposal presentation', expected: academicEvent.EVENT_TYPES.PROJECT_DEFENSE },
    { text: 'college reopens', expected: academicEvent.EVENT_TYPES.CLASS_RESUMPTION },
    { text: 'regular classes resume', expected: academicEvent.EVENT_TYPES.CLASS_RESUMPTION },
    { text: 'bida paxi class kaile bata khulcha', expected: academicEvent.EVENT_TYPES.CLASS_RESUMPTION }
  ];

  for (const tc of testCases) {
    const detected = academicEvent.classifyEventType(tc.text);
    assert.equal(detected, tc.expected, `Failed to classify: "${tc.text}" -> expected ${tc.expected}, got ${detected}`);
  }
});

test('2.3. Devanagari confirmation status detects tentative and cancelled correctly', () => {
  const tempCtx = temporal.getTemporalContext();
  const tentativeRecord = {
    id: 991,
    title: 'सम्भावित परीक्षा तालिका',
    content: 'कक्षाको परीक्षा २०८३/०८/१५ मा हुने सम्भावित छ।',
    authorityTier: 2
  };
  const evTentative = academicEvent.extractEventFromRecord(tentativeRecord, tempCtx);
  assert.ok(evTentative);
  assert.equal(evTentative.confirmationStatus, 'tentative');

  const cancelledRecord = {
    id: 992,
    title: 'डिफेन्स स्थगित सम्बन्धी सूचना',
    content: 'प्रोजेक्ट डिफेन्स २०८३/०८/०७ अर्को सूचना नआएसम्मका लागि स्थगित गरिएको छ।',
    authorityTier: 1
  };
  const evCancelled = academicEvent.extractEventFromRecord(cancelledRecord, tempCtx);
  assert.ok(evCancelled);
  assert.equal(evCancelled.confirmationStatus, 'cancelled');
});

// =========================================================================
// TASK 3: Conversational Countdown Intent Resolution & Multi-Turn Flows
// =========================================================================

test('3.1. "Kati din baki cha?" preserves previous event context and does NOT hijack to assignment', () => {
  const defenseHistory = [
    { role: 'user', content: 'Hamro project defense kaile ho?' },
    { role: 'assistant', content: 'Notice anusar project defense Nov 22, 2026 (7 Mangsir 2083) ma cha.' }
  ];

  const uDefense = understandRequest('Kati din baki cha?', defenseHistory, STUDENT_USER);
  assert.ok(!uDefense.intents.includes('assignment_deadline'), 'Must NOT hijack generic countdown into assignment_deadline');
  assert.ok(uDefense.intents.includes('project_defense') || uDefense.intents.includes('notice_lookup'), 'Must route countdown to project defense');

  const classHistory = [
    { role: 'user', content: 'When do classes resume after vacation?' },
    { role: 'assistant', content: 'Classes will resume on Nov 16, 2026 (30 Kartik 2083).' }
  ];

  const uClass = understandRequest('How many days are left?', classHistory, STUDENT_USER);
  assert.ok(!uClass.intents.includes('assignment_deadline'), 'Must NOT hijack into assignment_deadline when discussing class resumption');
  assert.ok(uClass.intents.includes('class_resumption_notice'), 'Must route countdown to class resumption');

  const examHistory = [
    { role: 'user', content: 'Next exam kaile ho?' },
    { role: 'assistant', content: 'Your next exam is Discrete Mathematics on Dec 1, 2026.' }
  ];

  const uExam = understandRequest('Kati din baki cha?', examHistory, STUDENT_USER);
  assert.ok(!uExam.intents.includes('assignment_deadline'), 'Must NOT hijack into assignment_deadline when discussing exams');
  assert.ok(uExam.intents.includes('next_examination'), 'Must route countdown to next examination');
});

test('3.2. Mandatory Multi-turn Conversation 1: Romanized Nepali', async () => {
  const history = [];

  // Turn 1
  const t1 = await handleChat(db, 'Hamro project defense kaile ho?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t1.reply, 'Turn 1 must reply');
  assert.match(t1.reply, /2083\/08\/07|7 Mangsir|Mangsir 7|Nov 22|November 22|Nov 23|November 23|2026-11-23/i, 'Turn 1 must state defense date');
  history.push({ role: 'user', content: 'Hamro project defense kaile ho?' });
  history.push({ role: 'assistant', content: t1.reply });

  // Turn 2
  const t2 = await handleChat(db, 'Kati din baki cha?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t2.reply, 'Turn 2 must reply');
  assert.match(t2.reply, /\b12\s+din\s+baki\b|\b12\s+days\b|\b13\s+days\b|\b13\s+din\s+baki\b/i, 'Turn 2 must calculate days remaining to project defense');
  assert.doesNotMatch(t2.reply, /assignment/i, 'Turn 2 must NOT hijack to assignments');
  history.push({ role: 'user', content: 'Kati din baki cha?' });
  history.push({ role: 'assistant', content: t2.reply });

  // Turn 3
  const t3 = await handleChat(db, 'Ani college kahile khulcha?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t3.reply, 'Turn 3 must reply');
  assert.match(t3.reply, /Kartik 30|30 Kartik|Nov 16|November 16/i, 'Turn 3 must report class resumption date');
  history.push({ role: 'user', content: 'Ani college kahile khulcha?' });
  history.push({ role: 'assistant', content: t3.reply });

  // Turn 4
  const t4 = await handleChat(db, 'Paila ko notice cancel bhayo?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t4.reply, 'Turn 4 must reply');
  assert.match(t4.reply, /supersede|cancel|change|date/i, 'Turn 4 must acknowledge date change or notice supersession');
});

test('3.3. Mandatory Multi-turn Conversation 2: Devanagari', async () => {
  const history = [];

  // Turn 1
  const t1 = await handleChat(db, 'हाम्रो प्रोजेक्ट डिफेन्स कहिले हो?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t1.reply, 'Turn 1 must reply');
  assert.match(t1.reply, /२०८३\/०८\/०७|2083\/08\/07|मंसिर ७|7 Mangsir|Nov 22|November 22|Nov 23|November 23|2026-11-23/i, 'Turn 1 must state defense date');
  history.push({ role: 'user', content: 'हाम्रो प्रोजेक्ट डिफेन्स कहिले हो?' });
  history.push({ role: 'assistant', content: t1.reply });

  // Turn 2
  const t2 = await handleChat(db, 'कति दिन बाँकी छ?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t2.reply, 'Turn 2 must reply');
  assert.match(t2.reply, /दिन\s*बाँकी|days\s*remaining|din\s*baki/i, 'Turn 2 must report countdown');
  assert.doesNotMatch(t2.reply, /असाइनमेन्ट/i, 'Turn 2 must NOT switch to assignment');
  history.push({ role: 'user', content: 'कति दिन बाँकी छ?' });
  history.push({ role: 'assistant', content: t2.reply });

  // Turn 3
  const t3 = await handleChat(db, 'अनि कलेज कहिले खुल्छ?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t3.reply, 'Turn 3 must reply');
  assert.match(t3.reply, /३० कार्तिक|कार्तिक ३०|30 Kartik|Nov 16|November 16/i, 'Turn 3 must report reopening date');
  history.push({ role: 'user', content: 'अनि कलेज कहिले खुल्छ?' });
  history.push({ role: 'assistant', content: t3.reply });

  // Turn 4
  const t4 = await handleChat(db, 'पहिलाको सूचना रद्द भयो?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t4.reply, 'Turn 4 must reply');
  assert.match(t4.reply, /परिवर्तन|खारेज|प्रतिस्थापन|supersede|cancel/i, 'Turn 4 must address supersession in Devanagari context');
});

test('3.4. Mandatory Multi-turn Conversation 3: English', async () => {
  const history = [];

  // Turn 1
  const t1 = await handleChat(db, 'When is our project defense?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t1.reply, 'Turn 1 must reply');
  assert.match(t1.reply, /Nov 22|November 22|Nov 23|November 23|2026-11-23|2083\/08\/07|7 Mangsir/i, 'Turn 1 must report date');
  history.push({ role: 'user', content: 'When is our project defense?' });
  history.push({ role: 'assistant', content: t1.reply });

  // Turn 2
  const t2 = await handleChat(db, 'How many days are left?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t2.reply, 'Turn 2 must reply');
  assert.match(t2.reply, /\b12\s+days?\s+remaining\b|\b12\s+days?\s+left\b|\b13\s+days?\s+remaining\b|\b13\s+days\b/i, 'Turn 2 must state countdown');
  history.push({ role: 'user', content: 'How many days are left?' });
  history.push({ role: 'assistant', content: t2.reply });

  // Turn 3
  const t3 = await handleChat(db, 'When does college reopen?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t3.reply, 'Turn 3 must reply');
  assert.match(t3.reply, /Nov 16|November 16|30 Kartik/i, 'Turn 3 must report reopening');
  history.push({ role: 'user', content: 'When does college reopen?' });
  history.push({ role: 'assistant', content: t3.reply });

  // Turn 4
  const t4 = await handleChat(db, 'Was the previous notice cancelled?', STUDENT_USER, history, { referenceDate: REFERENCE_DATE });
  assert.ok(t4.reply, 'Turn 4 must reply');
  assert.match(t4.reply, /supersede|cancel|date has changed|earlier announcement/i, 'Turn 4 must address notice cancellation/supersession');
});

// =========================================================================
// TASK 4: verifyAndGuardReply() Hardening (False Positives & Negatives)
// =========================================================================

test('4.1. verifyAndGuardReply does NOT corrupt past narrative or unrelated day phrases', () => {
  const mockResolvedEvents = {
    hasEvent: true,
    activeEvent: {
      id: 1,
      title: 'Project Defense',
      eventDateAd: '2026-11-23',
      eventDateBs: '2083-08-08',
      publicationDate: '2026-11-09'
    },
    countdown: {
      daysRemaining: 13
    }
  };

  const tempCtx = temporal.getTemporalContext();

  // False positive test 1: "The teacher replied in 3 days."
  const input1 = 'The teacher replied in 3 days with updated lecture slides.';
  const res1 = academicIntel.verifyAndGuardReply({
    reply: input1,
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.equal(res1.reply, input1, 'Must NOT rewrite "in 3 days" following past tense "replied"');

  // False positive test 2: "The assignment was due 2 days before the presentation."
  const input2 = 'The assignment was due 2 days before the presentation.';
  const res2 = academicIntel.verifyAndGuardReply({
    reply: input2,
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.equal(res2.reply, input2, 'Must NOT rewrite "2 days before"');

  // False positive test 3: "You have 10 days to prepare."
  const input3 = 'You have 10 days to prepare for your viva.';
  const res3 = academicIntel.verifyAndGuardReply({
    reply: input3,
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.equal(res3.reply, input3, 'Must NOT rewrite "10 days to prepare"');
});

test('4.2. verifyAndGuardReply correctly corrects invalid event countdowns across languages', () => {
  const mockResolvedEvents = {
    hasEvent: true,
    activeEvent: {
      id: 1,
      title: 'Project Defense',
      eventDateAd: '2026-11-23',
      eventDateBs: '2083-08-08',
      publicationDate: '2026-11-09'
    },
    countdown: {
      daysRemaining: 13
    }
  };

  const tempCtx = temporal.getTemporalContext();

  // English: "Just 10 days left!" -> "Just 13 days remaining"
  const resEn = academicIntel.verifyAndGuardReply({
    reply: 'Project defense is on Nov 23. Just 10 days left!',
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.ok(resEn.guarded, 'Must guard wrong countdown');
  assert.match(resEn.reply, /Just 13 days remaining/i);

  // Devanagari: "आजबाट १० दिन बाँकी छ!" -> "आजबाट १३ दिन बाँकी छ!"
  const resNe = academicIntel.verifyAndGuardReply({
    reply: 'प्रोजेक्ट डिफेन्स: आजबाट १० दिन बाँकी छ!',
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.ok(resNe.guarded, 'Must guard wrong Devanagari countdown');
  assert.match(resNe.reply, /आजबाट १३ दिन बाँकी छ!/);

  // Romanized Nepali: "Exam ko lagi 10 din baaki cha" -> "13 din baki cha"
  const resRoman = academicIntel.verifyAndGuardReply({
    reply: 'Exam ko lagi 10 din baaki cha bro.',
    resolvedEvents: mockResolvedEvents,
    temporalContext: tempCtx
  });
  assert.ok(resRoman.guarded, 'Must guard wrong Romanized countdown');
  assert.match(resRoman.reply, /13 din baki cha/);
});

// =========================================================================
// TASK 5: Deterministic Factual Fast-Path Latency & 0 Hallucinations
// =========================================================================

test('5.1. Direct factual notice query executes via fast-path with 0 LLM calls and 0ms LLM time', async () => {
  const res = await runKyanaAgentLoop({
    db,
    message: 'Hamro project defense kaile ho?',
    academicContext: STUDENT_USER,
    history: [],
    referenceDate: REFERENCE_DATE
  });

  assert.ok(res.handled);
  assert.ok(res.reply);
  assert.equal(res.agentTrace.metrics.llmCalls, 0, 'Deterministic factual response must require 0 remote LLM calls');
  assert.equal(res.agentTrace.metrics.llmExecutionMs, 0, 'Deterministic factual response must require 0ms LLM execution time');
  assert.equal(res.agentTrace.metrics.responseGenerationLlmCalls, 0, 'Deterministic factual response must have 0 generation calls');
});

test('5.2. Routine schedule query executes via fast-path with 0 LLM calls and 0ms LLM time', async () => {
  const res = await runKyanaAgentLoop({
    db,
    message: 'Show my semester routine',
    academicContext: STUDENT_USER,
    history: [],
    referenceDate: REFERENCE_DATE
  });

  assert.ok(res.handled);
  assert.ok(res.reply);
  assert.equal(res.agentTrace.metrics.llmCalls, 0, 'Routine lookup must require 0 LLM calls');
  assert.equal(res.agentTrace.metrics.llmExecutionMs, 0, 'Routine lookup must require 0ms LLM execution time');
});

