'use strict';

const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');

// Load .env.local safely without printing or logging secrets
if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const { buildNoteKnowledge } = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');
const { searchNotes, invalidateSearchCache, indexNote } = require('../lib/note-search');
const { embedText } = require('../lib/knowledge-embeddings');

function toPostgresSql(sql) {
  let idx = 1;
  let inString = false;
  let out = '';
  const transformed = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  for (let i = 0; i < transformed.length; i++) {
    const ch = transformed[i];
    if (ch === "'") {
      if (inString && transformed[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
    } else if (ch === '?' && !inString) {
      out += `$${idx++}`;
    } else {
      out += ch;
    }
  }
  return out;
}

async function runBenchmark() {
  console.log('=== Step 1: Initializing PGlite with pgvector ===');
  const pg = new PGlite({ extensions: { vector } });

  const db = {
    isPostgres: true,
    all: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return (await pg.query(toPostgresSql(sql), norm)).rows;
    },
    get: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return (await pg.query(toPostgresSql(sql), norm)).rows[0] || null;
    },
    run: async (sql, ...params) => {
      const norm = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return { changes: (await pg.query(toPostgresSql(sql), norm)).rowCount || 0 };
    },
    query: async (sql, params = []) => await pg.query(sql, params),
    exec: async (sql) => await pg.exec(sql)
  };

  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      title TEXT,
      originalName TEXT,
      storedName TEXT,
      subject TEXT,
      chapter TEXT,
      semester TEXT,
      semester_no INTEGER,
      cohort_id TEXT,
      audience_scope TEXT DEFAULT 'cohort',
      author_role TEXT DEFAULT 'teacher',
      uploadedBy TEXT,
      uploadedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      visibility TEXT DEFAULT 'everyone'
    );
    CREATE TABLE IF NOT EXISTS students (
      studentId TEXT PRIMARY KEY,
      name TEXT,
      role TEXT DEFAULT 'student',
      cohortId TEXT,
      semester INTEGER
    );
    INSERT INTO students (studentId, name, role) VALUES
      ('teacher_dammar', 'Dammar Khadayat', 'teacher'),
      ('teacher_os', 'OS Faculty', 'teacher')
    ON CONFLICT (studentId) DO NOTHING;
    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      name TEXT
    );
    INSERT INTO cohorts (id, name) VALUES ('cohort_1', '2026 Cohort') ON CONFLICT (id) DO NOTHING;
  `);

  const baseMigration = fs.readFileSync('migrations/20261014_kyana_v3_knowledge.up.sql', 'utf8');
  await pg.exec(baseMigration);
  const upMigration = fs.readFileSync('migrations/20261110_kyana_note_vector_chunks.up.sql', 'utf8');
  await pg.exec(upMigration);

  // Set vector search enabled
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';

  console.log('\n=== Step 2: Extracting and Indexing Real Local Files with Live Gemini Embeddings ===');

  // File 26: PDF
  const file26Path = path.join(__dirname, '../uploads/034b57a5a925ced0a67a1e7a76e48320.pdf');
  const file26Buffer = fs.readFileSync(file26Path);

  const file26Row = {
    id: 26,
    title: 'Web Technology Notes Chapter 2',
    originalName: 'Web_Technology_Notes_Chapter_2.pdf',
    storedName: '034b57a5a925ced0a67a1e7a76e48320.pdf',
    subject: 'Web Technology',
    chapter: '2',
    semester: '4',
    semester_no: 4,
    cohort_id: 'cohort_1',
    audience_scope: 'cohort',
    uploadedBy: 'teacher_dammar'
  };

  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope)
    VALUES (26, $1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [file26Row.title, file26Row.originalName, file26Row.storedName, file26Row.subject, file26Row.chapter, file26Row.semester, file26Row.semester_no, file26Row.cohort_id, file26Row.audience_scope]);

  console.log('Extracting text for File 26 via indexNote...');
  await indexNote(db, file26Row, { buffer: file26Buffer });
  const doc26 = await db.get('SELECT content FROM note_search_documents WHERE id = ?', 26);
  file26Row.extracted_content = doc26.content;

  console.log(`Building knowledge resource for File 26...`);
  const knowledge26 = buildNoteKnowledge(file26Row);
  console.log(`Embedding ${knowledge26.chunks.length} chunks for File 26 via Gemini API...`);
  await persistKnowledgeResource(db, knowledge26);
  console.log(`File 26 indexed successfully with ${knowledge26.chunks.length} chunks!`);

  // File 32: DOCX (Terminal Notes)
  const file32Path = path.join(__dirname, '../uploads/321bb431ba13f696442b2ee021132726.docx');
  const file32Buffer = fs.readFileSync(file32Path);

  const file32Row = {
    id: 32,
    title: 'Linux and Mac Terminal Practical Guide',
    originalName: 'Linux_Mac_Terminal_Notes.docx',
    storedName: '321bb431ba13f696442b2ee021132726.docx',
    subject: 'Operating Systems',
    chapter: '1',
    semester: '4',
    semester_no: 4,
    cohort_id: 'cohort_1',
    audience_scope: 'cohort',
    uploadedBy: 'teacher_os'
  };

  await db.query(`
    INSERT INTO files (id, title, originalName, storedName, subject, chapter, semester, semester_no, cohort_id, audience_scope)
    VALUES (32, $1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [file32Row.title, file32Row.originalName, file32Row.storedName, file32Row.subject, file32Row.chapter, file32Row.semester, file32Row.semester_no, file32Row.cohort_id, file32Row.audience_scope]);

  console.log('Extracting text for File 32 via indexNote...');
  await indexNote(db, file32Row, { buffer: file32Buffer });
  const doc32 = await db.get('SELECT content FROM note_search_documents WHERE id = ?', 32);
  file32Row.extracted_content = doc32.content;

  console.log(`Building knowledge resource for File 32...`);
  const knowledge32 = buildNoteKnowledge(file32Row);
  console.log(`Embedding ${knowledge32.chunks.length} chunks for File 32 via Gemini API...`);
  await persistKnowledgeResource(db, knowledge32);
  console.log(`File 32 indexed successfully with ${knowledge32.chunks.length} chunks!`);

  console.log('\n=== Step 3: Running Queries & Measuring Distance and Calibration ===');

  const queries = [
    { name: '1. Exact Query: "explain SMTP protocol"', text: 'explain SMTP protocol', expected: 'File 26, Page 5' },
    { name: '2. Paraphrase Query: "how emails are sent between servers"', text: 'how emails are sent between servers', expected: 'File 26, Page 5' },
    { name: '3. Nepali Query: "SMTP protocol ko barema notes deu"', text: 'SMTP protocol ko barema notes deu', expected: 'File 26, Page 5' },
    { name: '4. Negative Query: "explain quantum entanglement"', text: 'explain quantum entanglement', expected: 'Must return nothing' },
    { name: '5. Paraphrase Query (File 32): "inspect active background processes in bash"', text: 'inspect active background processes in bash', expected: 'File 32, Section on ps/top/bg' },
    { name: '6. Paraphrase Query (File 32): "how to find current working folder in command prompt"', text: 'how to find current working folder in command prompt', expected: 'File 32, Section on pwd' }
  ];

  for (const q of queries) {
    invalidateSearchCache(db);
    console.log(`\n------------------------------------------------------------`);
    console.log(`QUERY: ${q.name}`);
    console.log(`Expected: ${q.expected}`);

    // Direct vector chunk query to inspect raw cosine distances
    const qVec = await embedText(q.text, { taskType: 'RETRIEVAL_QUERY' });
    const rawChunks = await db.all(`
      SELECT c.file_id, c.page_number, c.section_heading,
             (c.embedding <=> $1::vector) AS cosine_distance,
             c.content
      FROM knowledge_chunks c
      ORDER BY cosine_distance ASC
      LIMIT 3
    `, `[${qVec.join(',')}]`);

    console.log(`Top 3 Raw Vector Chunks:`);
    for (const ch of rawChunks) {
      console.log(`  File ${ch.file_id} | Page ${ch.page_number} | Distance: ${Number(ch.cosine_distance).toFixed(4)} | Heading: "${ch.section_heading || 'None'}"`);
      console.log(`    Excerpt: ${ch.content.slice(0, 120).replace(/\n+/g, ' ')}...`);
    }

    // End-to-end searchNotes call
    const startT = Date.now();
    const results = await searchNotes(db, { query: q.text, semester: 4 });
    const elapsed = Date.now() - startT;

    console.log(`End-to-End searchNotes result (latency: ${elapsed}ms):`);
    if (results.length === 0) {
      console.log(`  => ZERO results returned.`);
    } else {
      for (const res of results) {
        console.log(`  => File ${res.id} ("${res.title}") | matchType: ${res.matchType} | Score: ${res.score?.toFixed(4)} | Dist: ${res.vectorDistance?.toFixed(4) || 'N/A'}`);
        console.log(`     Excerpt: ${res.extractedContent?.slice(0, 140).replace(/\n+/g, ' ')}...`);
      }
    }
  }

  console.log('\n=== Step 4: Measuring Latency With and Without Vector Search ===');
  const benchmarkQuery = 'how emails are sent between servers';

  // Warmup
  await searchNotes(db, { query: benchmarkQuery, semester: 4 });

  // With Vector Search
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'true';
  const vectorTimes = [];
  for (let i = 0; i < 3; i++) {
    invalidateSearchCache(db);
    const t0 = Date.now();
    await searchNotes(db, { query: benchmarkQuery, semester: 4 });
    vectorTimes.push(Date.now() - t0);
  }
  const avgVectorTime = vectorTimes.reduce((a, b) => a + b, 0) / vectorTimes.length;

  // Without Vector Search (Keyword Only)
  process.env.KYANA_NOTE_VECTOR_SEARCH = 'false';
  const keywordTimes = [];
  for (let i = 0; i < 3; i++) {
    invalidateSearchCache(db);
    const t0 = Date.now();
    await searchNotes(db, { query: benchmarkQuery, semester: 4 });
    keywordTimes.push(Date.now() - t0);
  }
  const avgKeywordTime = keywordTimes.reduce((a, b) => a + b, 0) / keywordTimes.length;

  console.log(`Latency without vector search (Keyword-only): ${avgKeywordTime.toFixed(1)}ms (runs: ${keywordTimes.join(', ')}ms)`);
  console.log(`Latency with vector search (Hybrid RRF): ${avgVectorTime.toFixed(1)}ms (runs: ${vectorTimes.join(', ')}ms)`);
  console.log(`Vector Search Overhead (live embedding API + vector cosine distance): +${(avgVectorTime - avgKeywordTime).toFixed(1)}ms`);

  console.log('\n=== Benchmark Finished Successfully ===');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
