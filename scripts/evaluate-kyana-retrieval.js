#!/usr/bin/env node
'use strict';
// Isolated schema only, on an explicitly local PostgreSQL test server. Never loads
// the application DB module. --live sends ONLY the synthetic corpus to Gemini.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { records, queries } = require('../tests/fixtures/kyana/retrieval');
const { buildPostKnowledge } = require('../lib/knowledge-builder');
const { applyKnowledgeMigration } = require('../lib/knowledge-schema');
const { searchKnowledge } = require('../lib/knowledge-search');
const { batchEmbedTexts } = require('../lib/knowledge-embeddings');
const live = process.argv.includes('--live');
const connectionString = process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Evaluation requires a local test database');
const context = { authenticated: true, studentId: 'student', role: 'student', currentSemester: 2, cohortId: 'current' };
function metrics(cases) {
 const positive = cases.filter(c => c.expected.length), negative = cases.filter(c => !c.expected.length);
 const mean = (xs, fn) => xs.length ? xs.reduce((s, x) => s + fn(x), 0) / xs.length : null;
 return { queries: cases.length, positive: positive.length, noAnswer: negative.length,
  recallAt5: mean(positive, c => c.results.filter(id => c.expected.includes(id)).length / c.expected.length),
  precisionAt5: mean(positive, c => c.results.filter(id => c.expected.includes(id)).length / 5),
  returnedPrecision: mean(positive, c => c.results.length ? c.results.filter(id => c.expected.includes(id)).length / c.results.length : 0),
  mrr: mean(positive, c => { const i = c.results.findIndex(id => c.expected.includes(id)); return i < 0 ? 0 : 1 / (i + 1); }),
  falsePositiveRate: mean(negative, c => Number(c.results.length > 0)),
  noAnswerAccuracy: mean(negative, c => Number(c.results.length === 0)),
  meanSearchMs: mean(cases, c => c.ms), p95SearchMs: cases.map(c => c.ms).sort((a,b) => a-b)[Math.floor(cases.length * .95)] };
}
(async () => {
 process.env.KYANA_KNOWLEDGE_V3 = 'true'; process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
 const client = new Client({ connectionString }); await client.connect();
 const schema = `kyana_eval_${Date.now()}`;
 await client.query(`CREATE SCHEMA ${schema}`);
 await client.query(`SET search_path TO ${schema}, public`);
 try {
  await client.query(`CREATE TABLE students (studentId TEXT PRIMARY KEY, role TEXT);
   CREATE TABLE cohorts (id TEXT PRIMARY KEY);
   INSERT INTO students VALUES ('teacher', 'teacher'), ('student', 'student'); INSERT INTO cohorts VALUES ('current');
   CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id TEXT, title TEXT, content TEXT, type TEXT, category TEXT, cohort_id TEXT, semester_no INTEGER, audience_scope TEXT, visibility TEXT, target_all_semesters INTEGER, moderation_status TEXT DEFAULT 'active');
   CREATE TABLE files (id INTEGER PRIMARY KEY, title TEXT, semester TEXT, semester_no INTEGER, cohort_id TEXT, audience_scope TEXT);
   CREATE TABLE routine (id INTEGER PRIMARY KEY, semester INTEGER, subject_name TEXT);
   CREATE TABLE post_target_semesters (post_id INTEGER, semester INTEGER);
   CREATE TABLE assignments (id INTEGER PRIMARY KEY, title TEXT, description TEXT, subject TEXT, semester TEXT, semester_no INTEGER, cohort_id TEXT, audience_scope TEXT, deadline TIMESTAMPTZ);
  `);
  await applyKnowledgeMigration(client);
  const built = records.map(buildPostKnowledge);
  let vectors = null, queryVectors = null;
  if (live) {
   for (const envFile of ['.env', '.env.local']) { if (fs.existsSync(envFile)) process.loadEnvFile(envFile); }
   process.env.ENABLE_LIVE_GEMINI_IN_TESTS = 'true';
   vectors = await batchEmbedTexts(built.map(b => b.chunks[0].content));
   queryVectors = await batchEmbedTexts(queries.map(q => q.query), { taskType: 'RETRIEVAL_QUERY' });
  }
  for (let i = 0; i < records.length; i++) {
   const r = records[i], b = built[i];
   await client.query('INSERT INTO posts (id,user_id,title,content,type,category,cohort_id,semester_no,audience_scope,visibility,target_all_semesters) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [r.id,r.user_id,r.title,r.content,r.type,r.category,r.cohort_id,r.semester_no,r.audience_scope,r.visibility,r.target_all_semesters]);
   await client.query(`INSERT INTO knowledge_resources (id,resource_type,canonical_id,title,source_authority_tier,author_id,cohort_id,semester_no,audience_scope,target_all_semesters,visibility,web_url,mobile_route,content_hash) VALUES ($1,'notice',$2,$3,2,'teacher','current',2,'cohort',0,'everyone',$4,$5,$6)`, [b.resource.id,r.id,r.title,b.resource.web_url,b.resource.mobile_route,b.resource.content_hash]);
   // A controlled 0.60 cosine is a stress test, never called a real semantic embedding.
   const v = vectors?.[i] || [0.6, 0.8, ...Array(766).fill(0)];
   await client.query(`INSERT INTO knowledge_chunks (id,resource_id,content,embedding) VALUES ($1,$2,$3,$4::vector)`, [b.resource.id+':c0',b.resource.id,b.chunks[0].content,JSON.stringify(v)]);
  }
  const baselinePath = path.resolve('scratch/kyana-hardening/knowledge-search.before.js');
  let baseline;
  if (fs.existsSync(baselinePath)) {
   const Module = require('module'); const mod = new Module(path.resolve('lib/knowledge-search.before.js'), module);
   mod.filename = path.resolve('lib/knowledge-search.before.js'); mod.paths = module.paths;
   mod._compile(fs.readFileSync(baselinePath,'utf8'),mod.filename); baseline = mod.exports.searchKnowledge;
  }
  const report = { generatedAt: new Date().toISOString(), corpus: { source: 'synthetic', records: records.length, queries: queries.length }, embeddingMode: live ? 'real_gemini_embedding_001' : 'controlled_cosine_0.60_stress_test', results: {} };
  for (const [name, search] of [['before', baseline], ['after', searchKnowledge]]) {
   if (!search) continue;
   for (const mode of ['keyword_only','hybrid']) {
    const cases = [];
    for (let i=0;i<queries.length;i++) {
     const q = queries[i], t = performance.now();
     const results = await search(client, context, q.query, { limit:5, searchMode:mode, ...(mode === 'hybrid' ? { queryVector: JSON.stringify(queryVectors?.[i] || [1,...Array(767).fill(0)]) } : {}) });
     cases.push({ ...q, results: results.map(r=>r.id), ms:performance.now()-t });
    }
    report.results[`${name}_${mode}`] = { overall:metrics(cases), byLanguage:Object.fromEntries([...new Set(cases.map(c=>c.language))].map(lang=>[lang, metrics(cases.filter(c=>c.language===lang))])), failures:cases.filter(c=>c.expected.length ? !c.results.some(id=>c.expected.includes(id)) : c.results.length) };
   }
  }
  fs.mkdirSync('scratch/kyana-hardening',{recursive:true});
  const out = `scratch/kyana-hardening/retrieval-${live?'live':'offline'}.json`;
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({ report:out, mode:report.embeddingMode, results:Object.fromEntries(Object.entries(report.results).map(([k,v])=>[k,v.overall])) },null,2));
 } finally { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
