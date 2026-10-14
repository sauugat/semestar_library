#!/usr/bin/env node
'use strict';

/**
 * Evaluates real student questions from a JSON fixture file and prints Recall@5 per language.
 *
 * Usage:
 *   node scripts/eval-real-questions.js [--file=path/to/questions.json]
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { searchKnowledge } = require('../lib/knowledge-search');

const defaultFixture = path.resolve(__dirname, '../tests/fixtures/real-questions.template.json');
const targetArg = process.argv.find(a => a.startsWith('--file='));
const filePath = targetArg ? path.resolve(process.cwd(), targetArg.split('=')[1]) : defaultFixture;

if (!fs.existsSync(filePath)) {
  console.error(`Fixture file not found: ${filePath}`);
  process.exit(1);
}

const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
console.log(`Loaded ${questions.length} test questions from ${filePath}`);

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  const stats = {};
  let totalHits = 0;

  for (const q of questions) {
    const lang = q.lang || 'en';
    if (!stats[lang]) stats[lang] = { total: 0, hits: 0 };
    stats[lang].total++;

    const ctx = Object.assign({ authenticated: true }, q.academicContext || {});
    const results = await searchKnowledge(client, ctx, q.query, { limit: 5 });
    const top5Ids = results.slice(0, 5).map(r => r.id);
    const hit = top5Ids.includes(q.expectedId);

    if (hit) {
      stats[lang].hits++;
      totalHits++;
    }
  }

  console.log('\n========================================');
  console.log('REAL QUESTIONS EVALUATION RESULTS');
  console.log('========================================');
  for (const [lang, s] of Object.entries(stats)) {
    const recall = s.total > 0 ? ((s.hits / s.total) * 100).toFixed(1) : '0.0';
    console.log(`${lang.padEnd(10)}: ${recall}% (${s.hits}/${s.total})`);
  }
  const overall = questions.length > 0 ? ((totalHits / questions.length) * 100).toFixed(1) : '0.0';
  console.log('----------------------------------------');
  console.log(`OVERALL   : ${overall}% (${totalHits}/${questions.length})`);
  console.log('========================================\n');

  await client.end();
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
