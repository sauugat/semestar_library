'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERSONALITY_VERSION,
  PERSONALITY_PROMPT,
  FEW_SHOT_EXAMPLES,
  getFewShotExamples,
  detectLanguage,
  detectExplicitLanguageSwitch,
  toneInstructions
} = require('../lib/chat-personality');
const { routeQuery, searchQuery, extractFilters } = require('../lib/chat-tools');
const { parseNepaliDateExpression } = require('../lib/nepali-dates');
const { handleChat } = require('../ai-assistant');

test('Kyana Centralized Personality: Versioning & Anti-Robotic Rules', () => {
  assert.equal(PERSONALITY_VERSION, '2.2.0');
  assert.match(PERSONALITY_PROMPT, /Kyana/);
  assert.match(PERSONALITY_PROMPT, /platonic/);
  assert.match(PERSONALITY_PROMPT, /NO "Certainly!"/);
  assert.match(PERSONALITY_PROMPT, /NO "Great question!"/);
  assert.match(PERSONALITY_PROMPT, /NO "As an AI assistant\.\.\."/);
  assert.match(PERSONALITY_PROMPT, /NEVER confuse Nepali with Hindi/);
  assert.ok(FEW_SHOT_EXAMPLES.length >= 20, 'Expected at least 20 curated few-shot examples');
});

test('Kyana Romanized Nepali Spelling Resilience', () => {
  const variations = [
    'mlai css ko notes khojdeu na',
    'kinw testo vako thaha xaina',
    'voli exam xa k garam?',
    'tmi le bujheu ta?',
    'aile padna jhyau lagyo',
    'yo code le kam garxu ki garxa?',
    'maile bujhina yo concept',
    'haina yrr tyo haina'
  ];
  for (const text of variations) {
    const lang = detectLanguage(text);
    assert.ok(lang === 'romanized_nepali' || lang === 'mixed', `Failed detection for: ${text} (got ${lang})`);
  }
});

test('Kyana Four-Way Language Adaptation', () => {
  assert.equal(detectLanguage('Can you explain recursion?'), 'english');
  assert.equal(detectLanguage('Recursion vaneko k ho?'), 'romanized_nepali');
  assert.equal(detectLanguage('Bro recursion ko simple example deu na in C.'), 'mixed');
  assert.equal(detectLanguage('मलाई recursion बुझाइदेऊ।'), 'devanagari');
});

test('Kyana Explicit Language Switching', () => {
  assert.equal(detectExplicitLanguageSwitch('English ma explain gara na'), 'english');
  assert.equal(detectExplicitLanguageSwitch('Feri Nepali ma vana'), 'nepali');
  assert.equal(detectExplicitLanguageSwitch('Switch to Nepali please'), 'nepali');
  assert.equal(detectExplicitLanguageSwitch('Reply strictly in English'), 'english');
  assert.equal(detectExplicitLanguageSwitch('What is an array?'), null);
});

test('Kyana Nepali Date Expressions (Asia/Kathmandu)', () => {
  const aaja = parseNepaliDateExpression('aaja kun exam xa?');
  assert.equal(aaja.expression, 'aaja');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(aaja.date));

  const voli = parseNepaliDateExpression('voli exam xa?');
  assert.equal(voli.expression, 'bholi');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(voli.date));

  const hijo = parseNepaliDateExpression('hijo aako notice');
  assert.equal(hijo.expression, 'hijo');

  const asti = parseNepaliDateExpression('asti sir le haleko post');
  assert.equal(asti.expression, 'asti');

  const yoHapta = parseNepaliDateExpression('yo hapta assignment xa?');
  assert.equal(yoHapta.expression, 'yo hapta');
  assert.ok(yoHapta.startDate && yoHapta.endDate);
});

test('Kyana Search Query Intent & Filler Stripping', () => {
  const q1 = routeQuery('CSS ko notes khojdeu.');
  assert.equal(q1.kind, 'notes');
  assert.equal(q1.query, 'css');

  const q2 = routeQuery('Hamro semester ko routine dekhauna.');
  assert.equal(q2.kind, 'routine');

  const q3 = routeQuery('Latest notice aako xa?');
  assert.equal(q3.kind, 'notices');

  const q4 = routeQuery('Voli kunai assignment xa?');
  assert.equal(q4.kind, 'assignments');
  assert.ok(q4.filters.dateInfo);

  const q5 = routeQuery('Web Technology ko sabai notes chaiyo.');
  assert.equal(q5.kind, 'notes');
  assert.ok(q5.filters.subject.includes('Web Technology'));
});

test('Kyana Multi-Turn Anaphora & Relative Reference Resolution', async () => {
  // Test 1: Refinement ("CSS ko matra")
  const priorUser = 'Web Tech ko notes khoja.';
  const refinement = routeQuery('CSS ko matra.', [{ role: 'user', content: priorUser }]);
  assert.equal(refinement.kind, 'notes');
  assert.equal(refinement.query, 'css');

  // Test 2: Relative Reference ("Second wala khola")
  const historyWithCards = [
    { role: 'user', content: 'Web Tech ko notes khoja.' },
    {
      role: 'assistant',
      content: 'Found 3 notes.',
      resourceCards: [
        { id: 101, title: 'Web Tech Intro', action: 'open_note', deepLink: '/material/101' },
        { id: 102, title: 'CSS Selectors and Flexbox', action: 'open_note', deepLink: '/material/102' },
        { id: 103, title: 'JS Basics', action: 'open_note', deepLink: '/material/103' }
      ]
    }
  ];

  const relRoute = routeQuery('second wala khola', historyWithCards);
  assert.equal(relRoute.kind, 'relative_reference');
  assert.equal(relRoute.index, 1);

  const res = await handleChat({}, 'second wala khola', {}, historyWithCards, 'test_rel');
  assert.match(res.reply, /CSS Selectors and Flexbox open gardai chu/);
  assert.equal(res.resourceCards.length, 1);
  assert.equal(res.resourceCards[0].id, 102);
});

test('Kyana Context Compaction on Long Conversations', async () => {
  // Construct a 14-message history
  const longHistory = [];
  for (let i = 1; i <= 7; i++) {
    longHistory.push({ role: 'user', content: `Question ${i} about topic ${i}` });
    longHistory.push({ role: 'assistant', content: `Answer ${i}` });
  }

  let capturedHistory = null;
  await handleChat({}, 'What is a pointer?', {}, longHistory, 'compact_test', {
    generateReply: async (args) => {
      capturedHistory = args.history;
      return { reply: 'A pointer stores a memory address.' };
    }
  });

  assert.ok(capturedHistory.length <= 10, 'History should be compacted to bound token usage');
  assert.ok(capturedHistory[0].content.includes('Earlier context summary'), 'Should contain compaction summary header');
});
