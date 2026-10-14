#!/usr/bin/env node
'use strict';

/**
 * CLI script to inspect the last 50 per-request timings for KYANA AI 3.0 Knowledge Retrieval.
 * Prints latency breakdown: Context Load, Embedding, Retrieval, TTFT, Total, and record counts.
 * Contains zero content, zero secrets.
 */

const { getRecentTimings, getTimingSummary } = require('../lib/knowledge-timing');

function main() {
  const timings = getRecentTimings(50);
  const summary = getTimingSummary();

  console.log('\n================================================================================');
  console.log('              KYANA AI 3.0 KNOWLEDGE RETRIEVAL — RECENT TIMINGS                ');
  console.log('================================================================================');

  if (timings.length === 0) {
    console.log('No timings recorded yet in this process.');
    console.log('Ensure KYANA_KNOWLEDGE_V3=true and run sample queries.\n');
    return;
  }

  console.log(`Recorded Requests: ${summary.count}`);
  console.log(`Average Latencies:`);
  console.log(`  Context Load:   ${summary.avgContextLoadMs} ms`);
  console.log(`  Embedding:      ${summary.avgEmbeddingMs} ms`);
  console.log(`  Retrieval (SQL):${summary.avgRetrievalMs} ms`);
  console.log(`  Time to 1st Tok:${summary.avgTtftMs} ms`);
  console.log(`  Total Time:     ${summary.avgTotalMs} ms\n`);

  console.log('Last Requests (Newest First):');
  console.table(
    timings.map(t => ({
      Timestamp: t.timestamp.replace('T', ' ').substring(0, 19),
      'Context (ms)': t.contextLoadMs,
      'Embed (ms)': t.embeddingMs,
      'Retrieval (ms)': t.retrievalMs,
      'TTFT (ms)': t.timeToFirstTokenMs,
      'Total (ms)': t.totalMs,
      Records: t.retrievedCount,
      Cards: t.cardsCount,
      Fallback: t.fallback ? 'YES' : 'NO'
    }))
  );
  console.log('================================================================================\n');
}

if (require.main === module) {
  main();
}

module.exports = { main };
