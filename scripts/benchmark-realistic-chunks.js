#!/usr/bin/env node
'use strict';

/**
 * KYANA AI 3.0 — Realistic 10,000-Chunk Benchmark (G5c)
 * Generates ~2,000 resources with 1 to 8 chunks each (~10,000 chunks total)
 * distributed across cohorts (mercury, venus, earth, mars) and semesters (1..8).
 * Executes EXPLAIN ANALYZE with full in-SQL academic authorization and live base joins.
 */

const { Client } = require('pg');
const { generateDeterministicVector } = require('../lib/knowledge-embeddings');
const { applyKnowledgeMigration } = require('../lib/knowledge-schema');

const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54333/test_semester_library';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log('--- KYANA 3.0 REALISTIC 10,000-CHUNK BENCHMARK (G5c) ---');

  // Ensure tables and migration exist
  await applyKnowledgeMigration(client);

  console.log('Cleaning existing synthetic benchmark data...');
  await client.query(`
    DELETE FROM knowledge_chunks WHERE id LIKE 'bench_%';
    DELETE FROM knowledge_resources WHERE id LIKE 'bench_%';
    DELETE FROM posts WHERE id >= 10000 AND id < 20000;
  `);

  console.log('Generating 2,000 realistic resources across cohorts and semesters...');
  await client.query(`
    INSERT INTO cohorts (id, slot_code, display_name, current_semester)
    VALUES
      ('c_mercury', 'mercury', 'Mercury Cohort', 3),
      ('c_venus', 'venus', 'Venus Cohort', 5),
      ('c_earth', 'earth', 'Earth Cohort', 1),
      ('c_mars', 'mars', 'Mars Cohort', 7)
    ON CONFLICT (id) DO NOTHING;
  `);

  const cohorts = ['c_mercury', 'c_venus', 'c_earth', 'c_mars'];
  const visibilities = ['everyone', 'students_only', 'teachers_only', 'cohort_only'];
  const audienceScopes = ['cohort', 'all_students'];

  // Insert 2,000 resources in batches using SQL generate_series
  await client.query(`
    INSERT INTO posts (id, user_id, title, content, semester_no, cohort_id, category, visibility, audience_scope, target_all_semesters)
    SELECT
      10000 + s.i,
      'stu_alice',
      'Realistic Campus Post ' || s.i,
      'Detailed course discussion for unit ' || (1 + (s.i % 5)) || ' covering lecture material, slides, and homework exercises.',
      1 + (s.i % 8),
      CASE (s.i % 4)
        WHEN 0 THEN 'c_mercury'
        WHEN 1 THEN 'c_venus'
        WHEN 2 THEN 'c_earth'
        ELSE 'c_mars'
      END,
      CASE WHEN s.i % 5 = 0 THEN 'notice' ELSE 'general' END,
      CASE (s.i % 4)
        WHEN 0 THEN 'everyone'
        WHEN 1 THEN 'students_only'
        WHEN 2 THEN 'teachers_only'
        ELSE 'cohort_only'
      END,
      CASE WHEN s.i % 3 = 0 THEN 'all_students' ELSE 'cohort' END,
      CASE WHEN s.i % 6 = 0 THEN 1 ELSE 0 END
    FROM generate_series(1, 2000) AS s(i)
    ON CONFLICT (id) DO NOTHING;
  `);

  await client.query(`
    INSERT INTO knowledge_resources (
      id, resource_type, canonical_id, title, source_authority_tier,
      author_id, author_role, cohort_id, semester_no, audience_scope,
      target_all_semesters, visibility, web_url, mobile_route, mobile_params, content_hash
    )
    SELECT
      'bench_post:' || s.i,
      CASE WHEN s.i % 5 = 0 THEN 'notice' ELSE 'post' END,
      10000 + s.i,
      'Realistic Campus Post ' || s.i,
      1 + (s.i % 5),
      'stu_alice',
      'student',
      CASE (s.i % 4)
        WHEN 0 THEN 'c_mercury'
        WHEN 1 THEN 'c_venus'
        WHEN 2 THEN 'c_earth'
        ELSE 'c_mars'
      END,
      1 + (s.i % 8),
      CASE WHEN s.i % 3 = 0 THEN 'all_students' ELSE 'cohort' END,
      CASE WHEN s.i % 6 = 0 THEN 1 ELSE 0 END,
      CASE (s.i % 4)
        WHEN 0 THEN 'everyone'
        WHEN 1 THEN 'students_only'
        WHEN 2 THEN 'teachers_only'
        ELSE 'cohort_only'
      END,
      '/dashboard.html?post=' || (10000 + s.i),
      '/post/' || (10000 + s.i),
      jsonb_build_object('id', 10000 + s.i),
      'hash_' || s.i
    FROM generate_series(1, 2000) AS s(i)
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log('Generating chunks (1 to 8 chunks per resource, ~10,000 total)...');
  const dummyVec = '[' + new Array(768).fill('0.02').join(',') + ']';

  // Each resource gets (1 + (s.i % 8)) chunks.
  // Sum over 2,000 resources of (1 + (i % 8)) = 2000 * 4.5 = 9,000 chunks + extra 1,000 = 10,000!
  await client.query(`
    INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
    SELECT
      'bench_chk:' || r.i || ':' || c.k,
      'bench_post:' || r.i,
      c.k,
      'Chunk ' || c.k || ' of post ' || r.i || ' explaining database structures, memory models, query optimization and indexes in computer science.',
      'gemini-embedding-001',
      $1::vector(768)
    FROM generate_series(1, 2000) AS r(i)
    CROSS JOIN LATERAL generate_series(1, 1 + (r.i % 8)) AS c(k)
    ON CONFLICT (id) DO NOTHING;
  `, [dummyVec]);

  // Insert extra 1,000 chunks to comfortably exceed 10,000 chunks
  await client.query(`
    INSERT INTO knowledge_chunks (id, resource_id, chunk_index, content, embedding_model, embedding)
    SELECT
      'bench_chk_extra:' || e.i,
      'bench_post:' || (1 + (e.i % 2000)),
      10 + e.i,
      'Extra syllabus reference chunk ' || e.i || ' regarding examinations, grading policy, and practical code labs.',
      'gemini-embedding-001',
      $1::vector(768)
    FROM generate_series(1, 1500) AS e(i)
    ON CONFLICT (id) DO NOTHING;
  `, [dummyVec]);

  const countRes = await client.query('SELECT COUNT(*) AS c FROM knowledge_chunks');
  const totalChunks = Number(countRes.rows[0].c);
  console.log(`Verified total knowledge_chunks in database: ${totalChunks}`);

  // Run EXPLAIN ANALYZE on realistic query:
  // Student Alice in Mercury Cohort, Semester 3
  console.log('\nRunning EXPLAIN ANALYZE on realistic student retrieval query...');
  const explainSql = `
    EXPLAIN (ANALYZE, BUFFERS, TIMING)
    WITH ranked_chunks AS (
      SELECT
        r.id AS resource_id,
        r.resource_type,
        r.canonical_id,
        COALESCE(p.title, r.title) AS live_title,
        GREATEST(0.0, 1.0 - (c.embedding <=> $1::vector(768))) AS vector_sim,
        LEAST(1.0, ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', $2)) * 2.0) AS fts_score,
        ((6 - r.source_authority_tier) / 5.0) AS authority_boost,
        EXP(-GREATEST(0.0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.created_at)) / 86400.0) / 60.0) AS recency_boost
      FROM knowledge_resources r
      JOIN knowledge_chunks c ON c.resource_id = r.id
      LEFT JOIN posts p ON r.resource_type IN ('post', 'notice') AND p.id = r.canonical_id
      WHERE
        r.deleted_at IS NULL
        AND r.hidden_at IS NULL
        AND p.id IS NOT NULL
        -- Academic Authorization: Alice, Mercury, Semester 3 (with Historical Semester rule G3)
        AND (
          r.visibility IN ('everyone', 'students_only', 'cohort_only')
          AND (
            (r.audience_scope = 'all_students' AND (r.target_all_semesters = 1 OR r.semester_no IS NULL OR r.semester_no <= 3))
            OR (r.cohort_id = 'c_mercury' AND (r.target_all_semesters = 1 OR r.semester_no IS NULL OR r.semester_no <= 3))
          )
        )
    ),
    scored AS (
      SELECT
        resource_id,
        resource_type,
        canonical_id,
        live_title,
        (0.50 * vector_sim) + (0.35 * fts_score) + (0.10 * authority_boost) + (0.05 * recency_boost) AS combined_score,
        ROW_NUMBER() OVER (
          PARTITION BY resource_id
          ORDER BY (0.50 * vector_sim) + (0.35 * fts_score) + (0.10 * authority_boost) + (0.05 * recency_boost) DESC
        ) AS rank_in_resource
      FROM ranked_chunks
    )
    SELECT
      resource_id,
      live_title,
      ROUND(combined_score::numeric, 4) AS score
    FROM scored
    WHERE rank_in_resource = 1
      AND combined_score >= 0.40
    ORDER BY combined_score DESC
    LIMIT 10;
  `;

  const explainRes = await client.query(explainSql, [dummyVec, 'database optimization']);
  const planLines = explainRes.rows.map(r => r['QUERY PLAN']);
  console.log('\n--- REALISTIC SHAPE EXPLAIN ANALYZE PLAN ---');
  console.log(planLines.join('\n'));
  console.log('-------------------------------------------\n');

  // Extract execution time
  const planText = planLines.join('\n');
  const execMatch = planText.match(/Execution Time:\s*([0-9.]+)\s*ms/i);
  const planningMatch = planText.match(/Planning Time:\s*([0-9.]+)\s*ms/i);
  console.log(`Planning Time : ${planningMatch ? planningMatch[1] : 'N/A'}ms`);
  console.log(`Execution Time: ${execMatch ? execMatch[1] : 'N/A'}ms`);

  // Cleanup benchmark data
  console.log('\nCleaning up synthetic benchmark data...');
  await client.query(`
    DELETE FROM knowledge_chunks WHERE id LIKE 'bench_%';
    DELETE FROM knowledge_resources WHERE id LIKE 'bench_%';
    DELETE FROM posts WHERE id >= 10000 AND id < 20000;
  `);

  console.log('Realistic benchmark complete.');
  await client.end();
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
