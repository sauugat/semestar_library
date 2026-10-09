'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables from .env
const envPath = path.join(__dirname, '..', '.env');
const content = fs.readFileSync(envPath, 'utf8');
content.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
});

const secret = process.env.SUPABASE_JWT_SECRET;
const payload = {
  sub: 'e30d4501-5db9-4cbc-a147-3ee35ab63515',
  email: 'saugatxtra@gmail.com',
  role: 'authenticated',
  aud: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 7200,
  iat: Math.floor(Date.now() / 1000),
};

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
const token = `${header}.${body}.${sig}`;

const CONV_ID = 'bbb842c5-bdca-4cf3-8b08-e9ec5b264160';
const SMALL_FILE_ID = 56;  // ~32 KB PDF
const LARGE_FILE_ID = 166; // ~14.9 MB PDF

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

function parseServerTiming(headerStr) {
  if (!headerStr) return { auth: null, db: null, queries: null };
  const authMatch = headerStr.match(/auth;dur=([\d.]+)/);
  const dbMatch = headerStr.match(/db;dur=([\d.]+)/);
  const qMatch = headerStr.match(/queries;desc="(\d+)"/);
  return {
    auth: authMatch ? parseFloat(authMatch[1]) : null,
    db: dbMatch ? parseFloat(dbMatch[1]) : null,
    queries: qMatch ? parseInt(qMatch[1], 10) : null,
  };
}

async function measureEndpoint(name, url, options, samples = 5) {
  const durations = [];
  const authDurations = [];
  const dbDurations = [];
  const queriesList = [];
  let errorCount = 0;
  let bytesTransferred = 0;

  // Warm-up run
  try {
    const warmOpts = typeof options === 'function' ? options() : options;
    await fetch(url, warmOpts);
  } catch (e) {
    // Ignore warmup error
  }

  for (let i = 0; i < samples; i++) {
    const reqOpts = typeof options === 'function' ? options() : options;
    const t0 = process.hrtime.bigint();
    try {
      const res = await fetch(url, reqOpts);
      const buf = await res.arrayBuffer();
      const t1 = process.hrtime.bigint();
      const dur = Number(t1 - t0) / 1e6; // ms
      durations.push(dur);
      bytesTransferred = buf.byteLength;

      if (!res.ok) {
        errorCount++;
      }

      const st = parseServerTiming(res.headers.get('server-timing'));
      if (st.auth !== null) authDurations.push(st.auth);
      if (st.db !== null) dbDurations.push(st.db);
      if (st.queries !== null) queriesList.push(st.queries);
    } catch (err) {
      errorCount++;
    }
  }

  return {
    name,
    samples,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    errorRate: ((errorCount / samples) * 100).toFixed(1) + '%',
    avgAuth: authDurations.length ? percentile(authDurations, 50) : null,
    avgDb: dbDurations.length ? percentile(dbDurations, 50) : null,
    queries: queriesList.length ? percentile(queriesList, 50) : null,
    bytes: bytesTransferred,
  };
}

async function runSuite(baseUrl, envLabel) {
  console.log(`\n======================================================`);
  console.log(`RUNNING BENCHMARKS: ${envLabel} (${baseUrl})`);
  console.log(`======================================================`);

  const results = [];

  // 1. POST /api/dm/conversations/:id/messages
  let msgSeq = 0;
  const postMsg = await measureEndpoint(
    'POST /api/dm/conversations/:id/messages',
    `${baseUrl}/api/dm/conversations/${CONV_ID}/messages`,
    () => ({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: `bench_${Date.now()}_${++msgSeq}`,
        text: `Benchmark message ${msgSeq} at ${new Date().toISOString()}`
      })
    }),
    5
  );
  results.push(postMsg);

  // 2. GET /api/dm/conversations
  const getInboxes = await measureEndpoint(
    'GET /api/dm/conversations',
    `${baseUrl}/api/dm/conversations`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    5
  );
  results.push(getInboxes);

  // 3. GET /api/dm/conversations/:id/messages
  const getMsgs = await measureEndpoint(
    'GET /api/dm/conversations/:id/messages',
    `${baseUrl}/api/dm/conversations/${CONV_ID}/messages?limit=30`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    5
  );
  results.push(getMsgs);

  // 4. POST /api/dm/conversations/:id/typing
  const postTyping = await measureEndpoint(
    'POST /api/dm/conversations/:id/typing',
    `${baseUrl}/api/dm/conversations/${CONV_ID}/typing`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isTyping: true })
    },
    5
  );
  results.push(postTyping);

  // 5. GET /api/chat/admin/rooms
  const getRooms = await measureEndpoint(
    'GET /api/chat/admin/rooms',
    `${baseUrl}/api/chat/admin/rooms`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    5
  );
  results.push(getRooms);

  // 6. GET /api/search
  const getSearch = await measureEndpoint(
    'GET /api/search',
    `${baseUrl}/api/search?q=math`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    5
  );
  results.push(getSearch);

  // 7. GET /api/files/:id/view (Small PDF)
  const getSmallFile = await measureEndpoint(
    `GET /api/files/:id/view (Small PDF #${SMALL_FILE_ID})`,
    `${baseUrl}/api/files/${SMALL_FILE_ID}/view`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    3
  );
  results.push(getSmallFile);

  // 8. GET /api/files/:id/view (Large PDF)
  const getLargeFile = await measureEndpoint(
    `GET /api/files/:id/view (Large PDF #${LARGE_FILE_ID})`,
    `${baseUrl}/api/files/${LARGE_FILE_ID}/view`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    },
    3
  );
  results.push(getLargeFile);

  console.table(results.map(r => ({
    'Endpoint': r.name,
    'p50 Total (ms)': r.p50.toFixed(1),
    'p95 Total (ms)': r.p95.toFixed(1),
    'Auth (ms)': r.avgAuth !== null ? r.avgAuth.toFixed(1) : 'N/A',
    'DB (ms)': r.avgDb !== null ? r.avgDb.toFixed(1) : 'N/A',
    'Queries': r.queries !== null ? r.queries : 'N/A',
    'Error Rate': r.errorRate,
    'Payload': (r.bytes / 1024).toFixed(1) + ' KB'
  })));

  return results;
}

async function main() {
  const localResults = await runSuite('http://127.0.0.1:3000', 'Local Loopback (Express + Neon PG)');
  const lanResults = await runSuite('http://192.168.1.65:3000', 'Local LAN (192.168.1.65:3000)');
  const vercelResults = await runSuite('https://semestar-library.vercel.app', 'Deployed Vercel (Edge/Serverless)');

  const output = {
    timestamp: new Date().toISOString(),
    local: localResults,
    lan: lanResults,
    vercel: vercelResults,
  };

  fs.writeFileSync(path.join(__dirname, 'benchmark-results.json'), JSON.stringify(output, null, 2));
  console.log('\nAll benchmarks saved to scripts/benchmark-results.json');
}

main().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
