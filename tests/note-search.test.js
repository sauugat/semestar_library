'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { ensureIndex, indexNote, searchNotes, removeNoteIndex, normalizeSemester, MAX_FILE_BYTES, MAX_TEXT_CHARS } = require('../lib/note-search');

async function fixture(t) {
  const client = createClient({ url: ':memory:' });
  t.after(() => client.close());
  const db = {
    isPostgres: false,
    exec: sql => client.executeMultiple(sql),
    all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
    get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
    run: async (sql, ...args) => client.execute({ sql, args })
  };
  await db.exec(`CREATE TABLE files (id INTEGER PRIMARY KEY, title TEXT, originalName TEXT, storedName TEXT,
    subject TEXT, chapter TEXT, semester TEXT, uploadedAt TEXT, sizeBytes INTEGER);`);
  await ensureIndex(db);
  return db;
}

async function addNote(db, id, overrides = {}, text = '') {
  const file = { id, title: 'Week one', originalName: `note${id}.txt`, storedName: `test-note-${id}.txt`,
    subject: 'Database Management System', chapter: '1', semester: 'III', uploadedAt: '2026-01-01', sizeBytes: 0, ...overrides };
  await db.run('INSERT INTO files (id,title,originalName,storedName,subject,chapter,semester,uploadedAt,sizeBytes) VALUES (?,?,?,?,?,?,?,?,?)',
    ...['id', 'title', 'originalName', 'storedName', 'subject', 'chapter', 'semester', 'uploadedAt', 'sizeBytes'].map(key => file[key]));
  const status = await indexNote(db, file, { buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
  return { file, status };
}

function pdfFixture(text) {
  const stream = text ? `BT /F1 12 Tf 20 150 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += 'xref\n0 6\n0000000000 65535 f \n';
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test('FTS finds a topic present only in content and uses hard subject/semester filters', async t => {
  const db = await fixture(t);
  await addNote(db, 1, {}, 'Normalization removes redundant tuples from relations.');
  await addNote(db, 2, { semester: 'IV' }, 'Normalization removes redundant tuples from relations.');
  await addNote(db, 3, { subject: 'Networking' }, 'Normalization has a different meaning here.');
  const rows = await searchNotes(db, { query: 'normalization notes', semester: 3, subject: ['DBMS', 'Database Management System'] });
  assert.deepEqual(rows.map(row => Number(row.id)), [1]);
  assert.equal(rows[0].matchType, 'content');
  assert.match(rows[0].excerpt, /Normalization/);
  assert.equal(rows[0].content, undefined);
  assert.deepEqual(await searchNotes(db, { query: 'normalization', semester: 'invalid' }), []);
  assert.deepEqual(await searchNotes(db, { query: 'normalization', subject: 'nonexistent' }), []);
});

test('precise topic content beats unrelated titles in the same requested subject', async t => {
  const db = await fixture(t);
  await addNote(db, 1, { title: 'Introduction' }, 'SQL syntax and data types.');
  await addNote(db, 2, { title: 'Unit two' }, 'Normalization and normal forms.');
  const rows = await searchNotes(db, { query: 'normalization', subject: 'Database Management System' });
  assert.deepEqual(rows.map(row => Number(row.id)), [2]);
  const fullQuery = await searchNotes(db, { query: 'DBMS normalization notes semester 3', semester: 3, subject: ['DBMS', 'Database Management System'] });
  assert.deepEqual(fullQuery.map(row => Number(row.id)), [2]);
});

test('short subject terms do not match substrings inside unrelated words', async t => {
  const db = await fixture(t);
  await addNote(db, 1, { title: 'Networking', subject: 'Computer Networks' }, 'Switches and routers.');
  await addNote(db, 2, { title: 'C Programming', subject: 'C' }, 'Pointers and structs.');
  assert.deepEqual((await searchNotes(db, { query: 'C notes' })).map(row => Number(row.id)), [2]);
});

test('metadata matches precede content, results are capped, and empty query never returns the catalogue', async t => {
  const db = await fixture(t);
  await addNote(db, 1, { title: 'Normalization' }, 'Relations.');
  for (let id = 2; id < 7; id++) await addNote(db, id, {}, 'Normalization example.');
  const rows = await searchNotes(db, { query: 'normalization' });
  assert.equal(rows.length, 3);
  assert.equal(Number(rows[0].id), 1);
  assert.equal(rows[0].matchType, 'metadata');
  assert.deepEqual(await searchNotes(db, {}), []);
  assert.deepEqual(await searchNotes(db, { query: 'please show me notes' }), []);
  assert.equal((await searchNotes(db, { query: 'DBMS notes', subject: ['DBMS', 'Database Management System'] })).length, 3);
});

test('FTS triggers replace old content and deletion invalidates cached matches', async t => {
  const db = await fixture(t);
  const { file } = await addNote(db, 1, {}, 'Polymorphism inheritance encapsulation.');
  assert.equal((await searchNotes(db, { query: 'inheritance' })).length, 1);
  await indexNote(db, file, { buffer: Buffer.from('Transactions and indexes.') });
  assert.equal((await searchNotes(db, { query: 'inheritance' })).length, 0);
  assert.equal((await searchNotes(db, { query: 'transactions' })).length, 1);
  await removeNoteIndex(db, 1);
  assert.equal((await searchNotes(db, { query: 'transactions' })).length, 0);
});

test('PDF extracts actual text and an image-only/blank PDF records an honest empty status', async t => {
  const db = await fixture(t);
  const readable = await addNote(db, 1, { originalName: 'lecture.pdf' }, pdfFixture('Normalization and functional dependencies'));
  assert.equal(readable.status.status, 'indexed');
  assert.equal((await searchNotes(db, { query: 'functional dependencies' })).length, 1);
  const blank = await addNote(db, 2, { originalName: 'scanned.pdf' }, pdfFixture(''));
  assert.equal(blank.status.status, 'empty');
  assert.match(blank.status.error, /OCR/);
  assert.equal((await db.get('SELECT extraction_status FROM note_search_documents WHERE id = ?', 2)).extraction_status, 'empty');
});

test('DOCX extracts paragraph text', async t => {
  const db = await fixture(t);
  // JSZip is Mammoth's archive implementation; resolve it from that package for this fixture only.
  const JSZip = require(require.resolve('jszip', { paths: [require.resolve('mammoth')] }));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Polymorphism lets one interface support multiple implementations.</w:t></w:r></w:p></w:body></w:document>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const { status } = await addNote(db, 1, { originalName: 'oop.docx', subject: 'OOP' }, buffer);
  assert.equal(status.status, 'indexed');
  assert.equal((await searchNotes(db, { query: 'polymorphism' }))[0].matchType, 'content');
});

test('unsupported, oversized, malformed and truncated files persist extraction statuses', async t => {
  const db = await fixture(t);
  assert.equal((await addNote(db, 1, { originalName: 'image.png' }, '')).status.status, 'unsupported');
  assert.equal((await addNote(db, 2, { sizeBytes: MAX_FILE_BYTES + 1 }, '')).status.status, 'too_large');
  assert.equal((await addNote(db, 3, { originalName: 'broken.docx' }, 'not a zip')).status.status, 'error');
  const { status } = await addNote(db, 4, {}, 'a'.repeat(MAX_TEXT_CHARS + 10));
  assert.equal(status.truncated, true);
  assert.equal(status.chars, MAX_TEXT_CHARS);
});

test('rejects arbitrary file URLs and traversal before any network request', async t => {
  const db = await fixture(t);
  const { file } = await addNote(db, 1, {}, 'Existing valid text.');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Network must not be used.'); };
  t.after(() => { global.fetch = originalFetch; });
  for (const storedName of ['http://169.254.169.254/metadata.pdf', '../../.env']) {
    const result = await indexNote(db, { ...file, originalName: 'lecture.pdf', storedName });
    assert.equal(result.status, 'error');
  }
  assert.equal(calls, 0);
});

test('semester aliases and punctuation do not broaden search or break FTS syntax', async t => {
  const db = await fixture(t);
  await addNote(db, 1, { semester: 'Semester 3' }, 'ER diagrams explain entities and relationships.');
  for (const semester of [3, 'III', 'semester III', '3rd semester', 'third semester']) {
    assert.equal(normalizeSemester(semester), 3);
    assert.equal((await searchNotes(db, { query: '"ER diagram" OR *', semester })).length, 0);
    assert.equal((await searchNotes(db, { query: 'ER diagrams', semester })).length, 1);
  }
});
