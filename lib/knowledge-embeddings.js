'use strict';

const crypto = require('crypto');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM = 768;
const MAX_BATCH_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;

// Bounded TTL + LRU cache for query embeddings
const MAX_QUERY_EMBEDDING_CACHE_SIZE = 250;
const DEFAULT_QUERY_EMBEDDING_TTL_MS = Number(process.env.KYANA_EMBEDDING_CACHE_TTL_MS) || 10 * 60 * 1000; // 10 minutes
const queryEmbeddingCache = new Map();
let embeddingCacheHits = 0;
let embeddingCacheMisses = 0;

/**
 * Normalizes a query string for deterministic cache keying.
 */
function normalizeEmbeddingQueryKey(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a model-and-dimension-scoped cache key so embeddings from incompatible models
 * or task types never collide.
 */
function buildEmbeddingCacheKey(text, { model = EMBEDDING_MODEL, dim = EMBEDDING_DIM, taskType = 'RETRIEVAL_QUERY' } = {}) {
  const normalizedQuery = normalizeEmbeddingQueryKey(text);
  return `${model}:d${dim}:${taskType}:${normalizedQuery}`;
}

function getCachedQueryEmbedding(key, now = Date.now()) {
  const entry = queryEmbeddingCache.get(key);
  if (!entry) {
    embeddingCacheMisses++;
    return null;
  }
  if (entry.expiresAt <= now) {
    queryEmbeddingCache.delete(key);
    embeddingCacheMisses++;
    return null;
  }
  // Refresh LRU order
  queryEmbeddingCache.delete(key);
  queryEmbeddingCache.set(key, entry);
  embeddingCacheHits++;
  return entry.vector.slice();
}

function setCachedQueryEmbedding(key, vector, ttlMs = DEFAULT_QUERY_EMBEDDING_TTL_MS, maxSize = MAX_QUERY_EMBEDDING_CACHE_SIZE, now = Date.now()) {
  if (!Array.isArray(vector) || ttlMs <= 0 || maxSize <= 0) return;
  if (queryEmbeddingCache.has(key)) {
    queryEmbeddingCache.delete(key);
  }
  // Evict expired entries first if at capacity
  if (queryEmbeddingCache.size >= maxSize) {
    for (const [k, v] of queryEmbeddingCache.entries()) {
      if (v.expiresAt <= now) queryEmbeddingCache.delete(k);
      if (queryEmbeddingCache.size < maxSize) break;
    }
  }
  // Evict least-recently-used entry if still at capacity
  while (queryEmbeddingCache.size >= maxSize) {
    const oldestKey = queryEmbeddingCache.keys().next().value;
    if (oldestKey === undefined) break;
    queryEmbeddingCache.delete(oldestKey);
  }
  queryEmbeddingCache.set(key, {
    vector: vector.slice(),
    createdAt: now,
    expiresAt: now + ttlMs
  });
}

function clearEmbeddingCache() {
  queryEmbeddingCache.clear();
  embeddingCacheHits = 0;
  embeddingCacheMisses = 0;
}

function getEmbeddingCacheStats() {
  return {
    size: queryEmbeddingCache.size,
    maxSize: MAX_QUERY_EMBEDDING_CACHE_SIZE,
    ttlMs: DEFAULT_QUERY_EMBEDDING_TTL_MS,
    hits: embeddingCacheHits,
    misses: embeddingCacheMisses
  };
}

function normalizeVector(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIM || !values.every(Number.isFinite)) throw new Error('Invalid embedding dimensions or values');
  const norm = Math.hypot(...values);
  if (!norm) throw new Error('Zero embedding vector');
  return values.map(v => v / norm);
}

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
 * Embeds a single text string using gemini-embedding-001 (with bounded TTL/LRU caching for queries).
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
  const modelName = options.model || EMBEDDING_MODEL;
  const dim = options.outputDimensionality || EMBEDDING_DIM;
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const customFetch = options.customFetch || globalThis.fetch;

  if (options.forceEmbedError) {
    throw new Error(options.forceEmbedError);
  }

  const useCache = options.useCache !== undefined ? Boolean(options.useCache) : true;
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const cacheTtlMs = typeof options.cacheTtlMs === 'number' ? options.cacheTtlMs : DEFAULT_QUERY_EMBEDDING_TTL_MS;
  const maxCacheSize = typeof options.maxCacheSize === 'number' ? options.maxCacheSize : MAX_QUERY_EMBEDDING_CACHE_SIZE;
  const cacheKey = useCache ? buildEmbeddingCacheKey(text, { model: modelName, dim, taskType }) : null;

  if (useCache && cacheKey) {
    const cached = getCachedQueryEmbedding(cacheKey, now);
    if (cached) return cached;
  }

  if (options.testVector === true && process.env.NODE_ENV === 'test') {
    const vec = generateDeterministicVector(normalizeEmbeddingQueryKey(text), dim);
    if (useCache && cacheKey) {
      setCachedQueryEmbedding(cacheKey, vec, cacheTtlMs, maxCacheSize, now);
    }
    return vec;
  }
  if (!apiKey) throw new Error('Gemini embeddings are not configured');
  if (process.env.NODE_ENV === 'test' && !options.customFetch && !process.env.ENABLE_LIVE_GEMINI_IN_TESTS) throw new Error('Live embeddings disabled in tests');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent`;
  const payload = {
    model: `models/${modelName}`,
    content: {
      parts: [{ text: String(text) }]
    },
    taskType,
    outputDimensionality: dim
  };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const res = await customFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS)]) : AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS)
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
        await res.text().catch(() => '');
        throw new Error(`Gemini embedding failed with HTTP ${res.status}: [provider body omitted]`);
      }

      const json = await res.json();
      if (!json.embedding?.values) {
        throw new Error('Gemini embedding response missing values array');
      }

      const normalized = normalizeVector(json.embedding.values);
      if (useCache && cacheKey) {
        setCachedQueryEmbedding(cacheKey, normalized, cacheTtlMs, maxCacheSize, now);
      }
      return normalized;
    } catch (err) {
      if (options.signal?.aborted) throw options.signal.reason;
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

  if (options.testVector === true && process.env.NODE_ENV === 'test') return texts.map(t => generateDeterministicVector(t));
  if (!apiKey) throw new Error('Gemini embeddings are not configured');
  if (process.env.NODE_ENV === 'test' && !options.customFetch && !process.env.ENABLE_LIVE_GEMINI_IN_TESTS) throw new Error('Live embeddings disabled in tests');

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;
    let attempt = 0;
    let batchVectors = null;

    while (attempt < MAX_RETRIES) {
      try {
        const res = await customFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ requests }),
          signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]) : AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        });

        if (res.status === 429 || res.status === 503) {
          attempt++;
          if (attempt >= MAX_RETRIES) {
            throw new Error(`Gemini batch embedding rate-limited (${res.status}) after ${attempt} attempts`);
          }
          await sleep(300 * Math.pow(2, attempt) + Math.random() * 100);
          continue;
        }

        if (!res.ok) {
          await res.text().catch(() => '');
          throw new Error(`Gemini batch embedding HTTP ${res.status}: [provider body omitted]`);
        }

        const json = await res.json();
        if (!json.embeddings || !Array.isArray(json.embeddings)) {
          throw new Error('Gemini batch embedding response missing embeddings array');
        }

        if (json.embeddings.length !== chunk.length) throw new Error('Embedding batch size mismatch');
        batchVectors = json.embeddings.map(e => normalizeVector(e.values));
        break;
      } catch (err) {
        if (options.signal?.aborted) throw options.signal.reason;
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
  normalizeVector,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  MAX_QUERY_EMBEDDING_CACHE_SIZE,
  DEFAULT_QUERY_EMBEDDING_TTL_MS,
  normalizeEmbeddingQueryKey,
  buildEmbeddingCacheKey,
  clearEmbeddingCache,
  getEmbeddingCacheStats,
  embedText,
  batchEmbedTexts,
  generateDeterministicVector
};
