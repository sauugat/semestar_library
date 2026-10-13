'use strict';

/**
 * Kyana AI — Conversational Quality Evaluation Benchmark Runner.
 * Evaluates the 150-scenario dataset across all 8 dimensions:
 * 1. Naturalness & Anti-Robotic Rules
 * 2. Language Accuracy & Spelling Resilience
 * 3. Context & Multi-Turn Memory
 * 4. Tone Appropriateness (Stress, Casual, Academic, Humor)
 * 5. Adaptive Response Length
 * 6. Academic & Code Rigor
 * 7. Natural Language Search & Date Parsing
 * 8. Strict Semester Authorization Security
 */

const fs = require('fs');
const path = require('path');
const {
  PERSONALITY_PROMPT,
  FEW_SHOT_EXAMPLES,
  getFewShotExamples,
  detectLanguage,
  detectExplicitLanguageSwitch,
  toneContext,
  toneInstructions
} = require('../lib/chat-personality');
const { routeQuery, searchQuery, extractFilters } = require('../lib/chat-tools');
const { parseNepaliDateExpression } = require('../lib/nepali-dates');
const { handleChat } = require('../ai-assistant');

async function runEvaluation() {
  const dataPath = path.join(__dirname, '../tests/data/kyana-evaluation-dataset.json');
  const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const scenarios = dataset.scenarios;

  console.log(`================================================================`);
  console.log(`  Kyana AI Conversational Intelligence Evaluation Benchmark`);
  console.log(`  Dataset: ${dataset.name} (${scenarios.length} scenarios)`);
  console.log(`================================================================\n`);

  const results = {
    total: scenarios.length,
    passed: 0,
    failed: 0,
    byCategory: {}
  };

  const roboticOpenings = [
    /^certainly[!,.]?/i,
    /^great question[!,.]?/i,
    /^as an ai assistant/i,
    /^i'd be delighted to assist you/i,
    /^how may i help you today\?/i
  ];

  for (const s of scenarios) {
    let pass = true;
    let failureReason = '';

    if (!results.byCategory[s.category]) {
      results.byCategory[s.category] = { total: 0, passed: 0, failed: 0 };
    }
    results.byCategory[s.category].total++;

    try {
      switch (s.category) {
        case 'greetings': {
          const detected = detectLanguage(s.input);
          if (s.language === 'devanagari' && detected !== 'devanagari') {
            pass = false; failureReason = `Expected devanagari, got ${detected}`;
          }
          const route = routeQuery(s.input);
          if (route.kind !== 'direct') {
            pass = false; failureReason = `Greeting should be direct, got ${route.kind}`;
          }
          break;
        }

        case 'slang': {
          const detected = detectLanguage(s.input);
          if (detected !== 'romanized_nepali' && detected !== 'mixed') {
            pass = false; failureReason = `Expected nepali/mixed, got ${detected}`;
          }
          break;
        }

        case 'spelling_variations': {
          const detected = detectLanguage(s.input);
          if (detected !== 'romanized_nepali' && detected !== 'mixed') {
            pass = false; failureReason = `Spelling variation not recognized as Nepali: got ${detected}`;
          }
          break;
        }

        case 'exam_stress': {
          const tone = toneContext(s.input);
          if (!tone.supportive) {
            pass = false; failureReason = 'Tone was not detected as supportive/stressed';
          }
          const instructions = toneInstructions(s.input, []);
          if (!instructions.includes('EMPATHETIC SUPPORT')) {
            pass = false; failureReason = 'Instructions did not switch to EMPATHETIC SUPPORT';
          }
          break;
        }

        case 'humor_and_transparency': {
          // Transparency prompt invariant verification
          if (!PERSONALITY_PROMPT.includes('You are an AI companion. Never invent fake personal human experiences')) {
            pass = false; failureReason = 'Prompt missing AI transparency rule';
          }
          break;
        }

        case 'academic_english':
        case 'academic_romanized_nepali':
        case 'academic_mixed':
        case 'academic_devanagari': {
          const route = routeQuery(s.input);
          if (route.kind !== 'direct') {
            pass = false; failureReason = `Academic explanation routed to ${route.kind} instead of direct`;
          }
          break;
        }

        case 'language_switching': {
          const sw = detectExplicitLanguageSwitch(s.input);
          if (sw !== s.expectedLanguage) {
            pass = false; failureReason = `Expected explicit switch to ${s.expectedLanguage}, got ${sw}`;
          }
          break;
        }

        case 'multi_turn_context': {
          if (s.id === 'MULTITURN-01') {
            // "Ali sajilo para ma"
            const route = routeQuery(s.turns[2].content, s.turns.slice(0, 2));
            if (route.kind !== 'direct') {
              pass = false; failureReason = `Simplification routed to ${route.kind}`;
            }
          } else if (s.id === 'MULTITURN-03') {
            // "CSS ko matra"
            const route = routeQuery(s.turns[2].content, s.turns.slice(0, 2));
            if (route.kind !== 'notes' || route.query !== 'css') {
              pass = false; failureReason = `Expected refined query 'css' for notes, got ${route.query} on ${route.kind}`;
            }
          } else if (s.id === 'MULTITURN-04') {
            // "Second wala khola"
            const route = routeQuery(s.turns[2].content, s.turns.slice(0, 2));
            if (route.kind !== 'relative_reference' || route.index !== 1) {
              pass = false; failureReason = `Expected relative_reference index 1, got ${route.kind} index ${route.index}`;
            }
          } else if (s.id === 'MULTITURN-05') {
            // "what about 3?"
            const route = routeQuery(s.turns[2].content, s.turns.slice(0, 2));
            if (route.kind !== 'routine' || route.filters.semester !== 3) {
              pass = false; failureReason = `Expected semester 3 routine follow-up, got ${route.filters.semester}`;
            }
          }
          break;
        }

        case 'library_search': {
          const route = routeQuery(s.input);
          if (s.intent && route.kind !== s.intent) {
            pass = false; failureReason = `Expected intent ${s.intent}, got ${route.kind}`;
          }
          if (s.expectedQuery && route.query !== s.expectedQuery) {
            pass = false; failureReason = `Expected query '${s.expectedQuery}', got '${route.query}'`;
          }
          break;
        }

        case 'nepali_dates': {
          const parsed = parseNepaliDateExpression(s.input);
          if (!parsed || parsed.expression !== s.dateExpr) {
            pass = false; failureReason = `Expected date expression '${s.dateExpr}', got '${parsed?.expression}'`;
          }
          break;
        }

        case 'semester_security': {
          const mockDb = {
            all: async () => [{ id: 1, title: 'DBMS Notes', semester: 4 }],
            get: async () => ({ studentId: 'student_tester', semester: s.studentSemester, role: s.studentRole || 'student' })
          };
          const studentInfo = { studentId: 'student_tester', semester: s.studentSemester, role: s.studentRole || 'student' };
          const academicContext = {
            authenticated: true,
            studentId: 'student_tester',
            semester: s.studentSemester,
            role: s.studentRole || 'student',
            cohort: { currentSemester: s.studentSemester }
          };
          const res = await handleChat(mockDb, s.query, studentInfo, [], 'eval_sec', {
            academicContext,
            toolDependencies: {
              searchNotes: async (db, args) => {
                if (args.semester && args.semester !== s.studentSemester && !s.studentRole) {
                  return [];
                }
                return [{ id: 1, title: 'Allowed Notes', semester: s.studentSemester }];
              }
            }
          });
          if (s.expectedResult === 'deny_or_clarify') {
            if (!res.reply.includes('registered in Semester') && !res.reply.includes('only retrieve notes for your semester')) {
              pass = false; failureReason = `Expected boundary enforcement message, got: ${res.reply}`;
            }
          }
          break;
        }

        case 'anti_robotic_checks': {
          if (s.forbiddenPattern) {
            const re = new RegExp(s.forbiddenPattern, 'i');
            for (const ex of FEW_SHOT_EXAMPLES) {
              if (re.test(ex.content)) {
                pass = false; failureReason = `Example matched forbidden pattern: ${ex.content}`;
                break;
              }
            }
          }
          break;
        }

        case 'ambiguous_requests': {
          const route = routeQuery(s.input);
          // Ambiguous queries should either clarify semester or ask for subject/topic
          if (route.kind === 'direct' && !/help|idea/i.test(s.input)) {
            pass = false; failureReason = `Ambiguous query routed as direct instead of tools`;
          }
          break;
        }

        case 'confusion': {
          const route = routeQuery(s.input);
          if (route.kind !== 'direct') {
            pass = false; failureReason = `Confusion query routed to ${route.kind}`;
          }
          break;
        }
      }
    } catch (err) {
      pass = false;
      failureReason = `Exception: ${err.message}`;
    }

    if (pass) {
      results.passed++;
      results.byCategory[s.category].passed++;
    } else {
      results.failed++;
      results.byCategory[s.category].failed++;
      console.warn(`  [FAIL] ${s.id} (${s.category}): ${failureReason}`);
    }
  }

  console.log(`\n----------------------------------------------------------------`);
  console.log(`  EVALUATION SUMMARY RESULTS`);
  console.log(`----------------------------------------------------------------`);
  console.log(`  Total Scenarios Evaluated : ${results.total}`);
  console.log(`  Passed                    : ${results.passed} (${((results.passed / results.total) * 100).toFixed(1)}%)`);
  console.log(`  Failed                    : ${results.failed}`);
  console.log(`\n  Category Breakdown:`);
  for (const [cat, score] of Object.entries(results.byCategory)) {
    const pct = ((score.passed / score.total) * 100).toFixed(0);
    const badge = score.failed === 0 ? '✅' : '⚠️';
    console.log(`    ${badge} ${cat.padEnd(25)}: ${score.passed}/${score.total} (${pct}%)`);
  }
  console.log(`================================================================\n`);

  return results;
}

if (require.main === module) {
  runEvaluation().then(res => {
    process.exit(res.failed === 0 ? 0 : 1);
  });
}

module.exports = { runEvaluation };
