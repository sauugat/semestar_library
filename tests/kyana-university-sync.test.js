'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const { applyKnowledgeMigration } = require('../lib/knowledge-schema');
const { asKnowledgeDb } = require('../lib/knowledge-db');
const { buildGUKnowledge } = require('../lib/knowledge-builder');
const { persistKnowledgeResource } = require('../lib/knowledge-sync');
const { searchKnowledge } = require('../lib/knowledge-search');
const { resourceCard } = require('../lib/kyana-access');
const { stripHtml, normalizeGUIItem, syncGandakiUniversityNotices } = require('../lib/university-sync');

describe('KYANA 3.0 Phase 6 — Gandaki University Controlled Public Notice Sync Integration', () => {
  let client;
  let db;
  const connectionString = process.env.KYANA_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

  before(async () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    client = new Client({ connectionString });
    await client.connect();
    db = asKnowledgeDb(client);

    await applyKnowledgeMigration(client);

    await client.query(`
      DELETE FROM knowledge_resources WHERE id LIKE 'gu:%';
    `);
  });

  after(async () => {
    if (client) {
      await client.query("DELETE FROM knowledge_resources WHERE id LIKE 'gu:%'").catch(() => {});
      await client.end();
    }
  });

  test('1. Data normalization & HTML stripping: cleans title, extracts PDF link, preserves canonical URL', () => {
    const rawNotice = {
      id: 15009,
      date: '2026-10-09T15:38:38',
      link: 'https://www.gandakiuniversity.edu.np/pdfposter/scholorship/',
      title: { rendered: 'Gandaki University Scholarship &amp; Financial Aid Notice 2026' },
      content: { rendered: '<p>Applications are invited for merit scholarships.<br>Download: <a href="https://www.gandakiuniversity.edu.np/wp-content/uploads/2026/10/scholarship-form.pdf">Form</a></p>' }
    };

    const norm = normalizeGUIItem(rawNotice, 'pdfposter');
    assert.equal(norm.id, 15009);
    assert.equal(norm.title, 'Gandaki University Scholarship & Financial Aid Notice 2026');
    assert.equal(norm.link, 'https://www.gandakiuniversity.edu.np/pdfposter/scholorship/');
    assert.equal(norm.pdf_url, 'https://www.gandakiuniversity.edu.np/wp-content/uploads/2026/10/scholarship-form.pdf');
    assert.ok(norm.content.includes('merit scholarships'));
  });

  test('2. Knowledge resource builder: Tier 1 institutional authority, all-semester global target', () => {
    const norm = {
      id: 14580,
      type: 'page',
      title: 'Gandaki University Academic Calendar 2082-83',
      link: 'https://www.gandakiuniversity.edu.np/gandaki-university-academic-calendar/',
      date: '2026-06-15T10:00:00',
      content: 'Official Academic Calendar for 2082-83 session. First semester starts Shrawan, final exams in Poush.',
      pdf_url: 'https://www.gandakiuniversity.edu.np/wp-content/uploads/2026/06/Academic-Calendar-2082-83.pdf'
    };

    const built = buildGUKnowledge(norm);
    assert.equal(built.resource.id, 'gu:page:14580');
    assert.equal(built.resource.resource_type, 'gu_official');
    assert.equal(built.resource.source_authority_tier, 1, 'Official university information must have Tier 1 authority');
    assert.equal(built.resource.target_all_semesters, 1, 'Must target all semesters');
    assert.equal(built.resource.audience_scope, 'all_students');
    assert.equal(built.resource.visibility, 'everyone');
    assert.equal(built.resource.web_url, 'https://www.gandakiuniversity.edu.np/gandaki-university-academic-calendar/');
    assert.ok(built.chunks[0].content.includes('Official Portal'));
  });

  test('3. Live retrieval across semesters: Students in semester 1, 3, and 5 can all discover official university notices', async () => {
    const testItem = {
      id: 9901,
      type: 'pdfposter',
      title: 'Official Gandaki University Controller of Examination Guidelines',
      link: 'https://www.gandakiuniversity.edu.np/pdfposter/guidelines-for-examination-office/',
      date: '2026-09-02T17:11:58',
      content: 'Strict guidelines for all university examinations across all schools. Admit cards mandatory.',
      pdf_url: 'https://www.gandakiuniversity.edu.np/wp-content/uploads/2026/09/exam-guidelines.pdf'
    };

    const built = buildGUKnowledge(testItem);
    await persistKnowledgeResource(db, built, { keywordOnly: true });

    // Verify stored
    const krRes = await client.query("SELECT * FROM knowledge_resources WHERE id = 'gu:pdfposter:9901'");
    assert.equal(krRes.rows.length, 1);
    assert.equal(krRes.rows[0].source_authority_tier, 1);

    // Test retrieval as Semester 1 student
    const s1Context = {
      authenticated: true,
      studentId: 'stu_freshman',
      role: 'student',
      currentSemester: 1,
      cohort: { id: 'c_mercury', currentSemester: 1 }
    };
    const s1Results = await searchKnowledge(db, s1Context, 'controller examination guidelines admit cards', { minScore: 0.01 });
    const s1Match = s1Results.find(r => r.id === 'gu:pdfposter:9901');
    assert.ok(s1Match, 'Semester 1 student must discover university notices');
    assert.equal(s1Match.authorityTier, 1);
    assert.equal(s1Match.webUrl, 'https://www.gandakiuniversity.edu.np/pdfposter/guidelines-for-examination-office/');

    // Test retrieval as Semester 5 student
    const s5Context = {
      authenticated: true,
      studentId: 'stu_senior',
      role: 'student',
      currentSemester: 5,
      cohort: { id: 'c_venus', currentSemester: 5 }
    };
    const s5Results = await searchKnowledge(db, s5Context, 'controller examination guidelines admit cards', { minScore: 0.01 });
    const s5Match = s5Results.find(r => r.id === 'gu:pdfposter:9901');
    assert.ok(s5Match, 'Semester 5 student must also discover university notices');
  });

  test('4. Resource card navigation: points directly to official university canonical URL and mobile route', () => {
    const guResource = {
      id: 9901,
      canonical_id: 9901,
      title: 'Official Gandaki University Controller of Examination Guidelines',
      web_url: 'https://www.gandakiuniversity.edu.np/pdfposter/guidelines-for-examination-office/',
      mobile_route: '/notice/gu-9901',
      mobile_params: { id: 9901, source: 'gandakiuniversity', webUrl: 'https://www.gandakiuniversity.edu.np/pdfposter/guidelines-for-examination-office/' }
    };

    const card = resourceCard('gu_official', guResource);
    assert.equal(card.type, 'notice');
    assert.equal(card.title, 'Official Gandaki University Controller of Examination Guidelines');
    assert.equal(card.deepLink, 'https://www.gandakiuniversity.edu.np/pdfposter/guidelines-for-examination-office/');
    assert.equal(card.mobileRoute, '/notice/gu-9901');
    assert.equal(card.action, 'view_notice');
  });

  test('5. Sync runner robustness: live sync executes against official endpoints safely with dry-run/keyword fallback', async () => {
    const stats = await syncGandakiUniversityNotices(db, { keywordOnly: true });
    assert.ok(stats.scanned >= 0, 'Must return scanned count');
    assert.ok(typeof stats.indexed === 'number');
    assert.ok(typeof stats.skipped === 'number');
  });
});
