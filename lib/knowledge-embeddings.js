'use strict';

const crypto = require('crypto');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM = 768;
const MAX_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RETRIES = 3;

/**
 * Deterministic pseudo-random normalized 768-dim vector generator for tests/offline.
 */
function generateDeterministicVector(text, dim = EMBEDDING_DIM) {
  const hash = crypto.createHash('sha256').update(String(text)).digest();
  const vector = new Array(dim);
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const byte = hash[i % hash.length];
    const val = ((byte / 255) * 2 - 1) + Math.sin(i + byte);
    vector[i] = val;
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vector.map(v => Number((v / norm).toFixed(6)));
}

/**
 * Delays execution for ms milliseconds with optional jitter.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Embeds a single text string using gemini-embedding-001.
 *
 * @param {string} text Text to embed
 * @param {object} options
 * @param {string} options.taskType 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
 * @param {string} [options.apiKey] Optional API key override
 * @param {Function} [options.customFetch] Optional fetch override
 * @returns {Promise<number[]>} 768-dimensional float array
 */
async function embedText(text, options = {}) {
  const taskType = options.taskType || 'RETRIEVAL_DOCUMENT';
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const customFetch = options.customFetch || globalThis.fetch;

  if (options.forceEmbedError) {
    throw new Error(options.forceEmbedError);
  }

  if (!options.customFetch && (!apiKey || (process.env.NODE_ENV === 'test' && !process.env.ENABLE_LIVE_GEMINI_IN_TESTS))) {
    return generateDeterministicVector(text, EMBEDDING_DIM);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    model: `models/${EMBEDDING_MODEL}`,
    content: {
      parts: [{ text: String(text) }]
    },
    taskType,
    outputDimensionality: EMBEDDING_DIM
  };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const res = await customFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      });

      if (res.status === 429 || res.status === 503) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Gemini embedding rate-limited (${res.status}) after ${attempt} attempts`);
        }
        const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`Gemini embedding failed with HTTP ${res.status}: ${errorText.slice(0, 200)}`);
      }

      const json = await res.json();
      if (!json.embedding?.values) {
        throw new Error('Gemini embedding response missing values array');
      }

      return json.embedding.values.slice(0, EMBEDDING_DIM);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Gemini embedding request timed out after ${MAX_RETRIES} attempts`);
        }
        await sleep(400 * attempt);
        continue;
      }
      if (attempt >= MAX_RETRIES - 1) throw err;
      attempt++;
      await sleep(500 * attempt);
    }
  }

  throw new Error('Embedding failed unexpectedly');
}

/**
 * Batch embeds an array of texts using batchEmbedContents.
 *
 * @param {string[]} texts Array of texts to embed
 * @param {object} options
 * @param {string} options.taskType 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
 * @returns {Promise<Array<number[]>>}
 */
async function batchEmbedTexts(texts, options = {}) {
  if (!texts || texts.length === 0) return [];
  const taskType = options.taskType || 'RETRIEVAL_DOCUMENT';
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const customFetch = options.customFetch || globalThis.fetch;

  if (options.forceEmbedError) {
    throw new Error(options.forceEmbedError);
  }

  if (!options.customFetch && (!apiKey || (process.env.NODE_ENV === 'test' && !process.env.ENABLE_LIVE_GEMINI_IN_TESTS))) {
    return texts.map(t => generateDeterministicVector(t, EMBEDDING_DIM));
  }

  const results = [];
  // Slice into batches of MAX_BATCH_SIZE (100)
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const chunk = texts.slice(i, i + MAX_BATCH_SIZE);
    const requests = chunk.map(text => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: String(text) }] },
      taskType,
      outputDimensionality: EMBEDDING_DIM
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    let attempt = 0;
    let batchVectors = null;

    while (attempt < MAX_RETRIES) {
      try {
        const res = await customFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS * 2)
        });

        if (res.status === 429 || res.status === 503) {
          attempt++;
          if (attempt >= MAX_RETRIES) {
            throw new Error(`Gemini batch embedding rate-limited (${res.status}) after ${attempt} attempts`);
          }
          await sleep(600 * Math.pow(2, attempt) + Math.random() * 200);
          continue;
        }

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          throw new Error(`Gemini batch embedding HTTP ${res.status}: ${errorText.slice(0, 200)}`);
        }

        const json = await res.json();
        if (!json.embeddings || !Array.isArray(json.embeddings)) {
          throw new Error('Gemini batch embedding response missing embeddings array');
        }

        batchVectors = json.embeddings.map(e => e.values.slice(0, EMBEDDING_DIM));
        break;
      } catch (err) {
        if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
          attempt++;
          if (attempt >= MAX_RETRIES) throw err;
          await sleep(500 * attempt);
          continue;
        }
        if (attempt >= MAX_RETRIES - 1) throw err;
        attempt++;
        await sleep(600 * attempt);
      }
    }

    if (!batchVectors) {
      throw new Error('Failed to generate batch vectors');
    }
    results.push(...batchVectors);
  }

  return results;
}

module.exports = {
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  embedText,
  batchEmbedTexts,
  generateDeterministicVector
};
