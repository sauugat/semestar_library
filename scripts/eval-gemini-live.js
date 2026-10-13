'use strict';

/**
 * Kyana AI — Live Gemini Conversational Evaluation Runner
 * Invokes the live Gemini model backend using the configured GEMINI_API_KEY.
 * Tests representative conversations, multi-turn contexts (>20 turns),
 * language adaptation, and captures exact generated outputs for naturalness analysis.
 */

const fs = require('fs');
const path = require('path');
const { createChatProvider } = require('../lib/chat-provider');
const { PERSONALITY_PROMPT, toneInstructions, detectLanguage } = require('../lib/chat-personality');
const { handleChat } = require('../ai-assistant');

// Ensure GEMINI provider is active
const env = { ...process.env, CHAT_PROVIDER: 'gemini' };
const provider = createChatProvider({ env });

async function runLiveEvaluation() {
  console.log('================================================================');
  console.log('  Kyana AI Live Gemini Model Conversational Evaluation');
  console.log('  Provider: Gemini (gemini-3-flash-preview / fallback)');
  console.log('================================================================\n');

  const testCases = [
    {
      category: 'Casual Romanized Nepali',
      input: 'Oii k xa khabar? Aaja k gardai xau?',
      expectedTone: 'friendly, relaxed senior student tone'
    },
    {
      category: 'Nepali-English Code-Switching',
      input: 'Recursion ma base case kina chaincha explain gara ta, stack overflow huncha ho?',
      expectedTone: 'natural mixed tech Nepali'
    },
    {
      category: 'Informal Student Slang',
      input: 'Babal garo topic thyo yrr, pointer ra reference ko chakar bujhdai bujhina.',
      expectedTone: 'empathic student slang, clear distinction'
    },
    {
      category: 'Spelling Mistakes / Variations',
      input: 'Voli xam xa kei pdheko xina k grne mlai tanab vo',
      expectedTone: 'handles informal contractions naturally'
    },
    {
      category: 'Emotional Expressions / Exam Stress',
      input: 'Fail hunchu hola yrr, pass kasari hune kei idea deu na 😭',
      expectedTone: 'supportive, calming, actionable prioritization'
    },
    {
      category: 'Academic Concept Explanation',
      input: 'Operating system ma deadlock bhanya k ho? Real-life nepali example deu na.',
      expectedTone: 'clear conceptual grasp with intuitive Nepali analogy'
    }
  ];

  const results = [];

  console.log('--- 1. Testing Single-Turn Live Generations ---');
  for (const tc of testCases) {
    process.stdout.write(`Testing [${tc.category}]... `);
    const start = Date.now();
    try {
      const generated = await provider.generateReply({
        message: tc.input,
        history: [],
        systemPrompt: PERSONALITY_PROMPT + toneInstructions(tc.input, []),
        tools: []
      });
      const elapsed = Date.now() - start;
      console.log(`OK (${elapsed}ms)`);
      results.push({
        category: tc.category,
        input: tc.input,
        reply: generated.reply.trim(),
        elapsedMs: elapsed,
        status: 'SUCCESS'
      });
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      results.push({
        category: tc.category,
        input: tc.input,
        error: err.message,
        status: 'FAILED'
      });
    }
  }

  console.log('\n--- 2. Testing Multi-Turn & Language Switching Sequence ---');
  const multiTurnFlow = [
    { role: 'user', content: 'OOP ma inheritance ra polymorphism ko relation k ho?' },
    { role: 'assistant', content: 'Inheritance le parent class ko properties child class ma share garcha, ani polymorphism le chai tei shared method lai farak farak tareeka le behave garna dincha. Ek type ko parent feature reuse bhayo, arko chai flexible execution.' },
    { role: 'user', content: 'La aba English ma explain gara with a clean C++ example.' }
  ];

  let multiTurnReply = '';
  try {
    const gen = await provider.generateReply({
      message: multiTurnFlow[2].content,
      history: multiTurnFlow.slice(0, 2),
      systemPrompt: PERSONALITY_PROMPT + toneInstructions(multiTurnFlow[2].content, multiTurnFlow.slice(0, 2)),
      tools: []
    });
    multiTurnReply = gen.reply.trim();
    console.log('Multi-Turn + English Switch Reply received:');
    console.log(multiTurnReply.slice(0, 280) + '...\n');
  } catch (err) {
    console.error('Multi-turn failed:', err.message);
  }

  console.log('--- 3. Testing Long Multi-Turn Conversation (> 20 Messages) Memory Compaction ---');
  const longHistory = [];
  // Build a 20-message dialogue history discussing Web Tech & CSS
  for (let i = 1; i <= 10; i++) {
    longHistory.push({ role: 'user', content: `Message ${i}: We are revising Web Tech chapter ${i % 3 + 1}.` });
    longHistory.push({ role: 'assistant', content: `Bujhe! Chapter ${i % 3 + 1} ko concepts clear gardai jaam.` });
  }
  // Turn 21: Add specific topic
  longHistory.push({ role: 'user', content: 'Specifically flexbox and grid revision.' });
  longHistory.push({ role: 'assistant', content: 'Flexbox 1D layout ko lagi ani Grid 2D layout ko lagi perfect ho.' });

  // Turn 23: Test reference to earlier context
  let longConvReply = '';
  try {
    const longGen = await provider.generateReply({
      message: 'Hami kun subject ko revision gardai thiyou re? Aaja ko topic k thyo?',
      history: longHistory,
      systemPrompt: PERSONALITY_PROMPT,
      tools: []
    });
    longConvReply = longGen.reply.trim();
    console.log('Long Conversation (>20 turns) Retention Reply:');
    console.log(longConvReply + '\n');
  } catch (err) {
    console.error('Long conversation test failed:', err.message);
  }

  // Save report to disk
  const report = {
    timestamp: new Date().toISOString(),
    provider: 'gemini',
    singleTurnResults: results,
    multiTurnLanguageSwitch: {
      input: multiTurnFlow[2].content,
      reply: multiTurnReply
    },
    longConversationRetention: {
      totalHistoryLength: longHistory.length + 1,
      reply: longConvReply
    }
  };

  const outputPath = path.join(__dirname, '../tests/data/kyana-live-gemini-eval-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  return report;
}

if (require.main === module) {
  runLiveEvaluation().catch(err => {
    console.error('Fatal live evaluation error:', err);
    process.exit(1);
  });
}

module.exports = { runLiveEvaluation };
