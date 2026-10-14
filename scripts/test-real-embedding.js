#!/usr/bin/env node
'use strict';

/**
 * KYANA AI 3.0 — Real Embedding Call Verification (F5)
 * Calls actual configured Gemini embedding endpoint with one short test sentence.
 * Strictly prints ONLY: vector length, latency (ms), HTTP status, and model.
 * NEVER prints API keys, payload text, or raw vector values.
 */

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// Safely load environment files if present
for (const envFile of ['.env.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    try {
      process.loadEnvFile(fullPath);
    } catch (_) {}
  }
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY or GOOGLE_API_KEY is not set in environment.');
  process.exit(1);
}

const model = 'gemini-embedding-001';
const text = 'Gandaki University semester examination routine notice';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`;

const payload = {
  model: `models/${model}`,
  content: {
    parts: [{ text }]
  },
  taskType: 'RETRIEVAL_DOCUMENT',
  outputDimensionality: 768
};

async function testRealEmbedding() {
  const start = performance.now();
  let status = null;
  let vectorLen = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    status = res.status;
    const durationMs = Math.round(performance.now() - start);

    if (!res.ok) {
      console.error(`HTTP Status  : ${status}`);
      console.error(`Latency      : ${durationMs}ms`);
      console.error('Embedding API returned non-200 response.');
      process.exit(1);
    }

    const data = await res.json();
    vectorLen = data?.embedding?.values?.length || 0;

    console.log('--- REAL GEMINI EMBEDDING VERIFICATION ---');
    console.log(`HTTP Status  : ${status}`);
    console.log(`Latency      : ${durationMs}ms`);
    console.log(`Vector Length: ${vectorLen}`);
    console.log(`Model        : ${model}`);
    console.log('------------------------------------------');

    if (vectorLen === 768) {
      process.exit(0);
    } else {
      console.error(`Unexpected vector length: expected 768, got ${vectorLen}`);
      process.exit(1);
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    console.error(`HTTP Status  : ${status || 'Network/Timeout Error'}`);
    console.error(`Latency      : ${durationMs}ms`);
    console.error(`Error        : ${err.message}`);
    process.exit(1);
  }
}

testRealEmbedding();
