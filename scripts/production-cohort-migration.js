'use strict';

/**
 * Controlled Production Migration Script for Academic Cohort Architecture
 * Executes within a single PostgreSQL transaction with strict validation.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const { normalizeSemester } = require('../lib/note-search');

const CANONICAL_COHORTS = [
  { slotCode: 'mercury', displayName: 'Mercury', currentSemester: 1, intakeYear: 2024, intakeIdentifier: 'BIT-2024' },
  { slotCode: 'venus',   displayName: 'Venus',   currentSemester: 3, intakeYear: 2023, intakeIdentifier: 'BIT-2023' },
  { slotCode: 'earth',   displayName: 'Earth',   currentSemester: 5, intakeYear: 2022, intakeIdentifier: 'BIT-2022' },
  { slotCode: 'mars',    displayName: 'Mars',    currentSemester: 7, intakeYear: 2021, intakeIdentifier: 'BIT-2021' }
];

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required in environment');
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  console.log('Connected to production database.');

  try {
    await client.query('BEGIN');
    console.log('Transaction started.');

    // 1. Audit / Pre-counts
    const preStudents = await client.query('SELECT COUNT(*) AS c FROM students');
    const prePosts = await client.query('SELECT COUNT(*) AS c FROM posts');
    const preFiles = await client.query('SELECT COUNT(*) AS c FROM files');
    const preAssignments = await client.query('SELECT COUNT(*) AS c FROM assignments');
    const preRooms = await client.query('SELECT COUNT(*) AS c FROM chat_groups');

    console.log(`Pre-migration counts: Students=${preStudents.rows[0].c}, Posts=${prePosts.rows[0].c}, Files=${preFiles.rows[0].c}, Assignments=${preAssignments.rows[0].c}, Rooms=${preRooms.rows[0].c}`);

    // 2. Ensure schema & partial unique index
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_active_slot 
      ON cohorts (slot_code) 
      WHERE status = 'active';
    `);

    // 3. Create or Link Initial Active Cohorts
    const cohortMap = {}; // slotCode -> { id, currentSemester }
    for (const c of CANONICAL_COHORTS) {
      const existing = await client.query(
        "SELECT * FROM cohorts WHERE slot_code = $1 AND status = 'active'",
        [c.slotCode]
      );
      if (existing.rows.length > 0) {
        cohortMap[c.slotCode] = existing.rows[0];
        console.log(`Cohort ${c.slotCode} already exists: ${existing.rows[0].id}`);
      } else {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await client.query(`
          INSERT INTO cohorts (id, slot_code, display_name, intake_year, intake_identifier, current_semester, status, created_at, updated_at, group_code, version)
          VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7, $8, 1)
        `, [id, c.slotCode, c.displayName, c.intakeYear, c.intakeIdentifier, c.currentSemester, now, c.slotCode.toUpperCase()]);

        // Insert semester history
        const histId = crypto.randomUUID();
        await client.query(`
          INSERT INTO cohort_semester_history (id, cohort_id, semester_no, started_at, created_at)
          VALUES ($1, $2, $3, $4, $4)
        `, [histId, id, c.currentSemester, now]);

        // Insert audit log
        const auditId = crypto.randomUUID();
        await client.query(`
          INSERT INTO cohort_audit_logs (id, cohort_id, action, actor_id, details_json, created_at)
          VALUES ($1, $2, 'create', '26020266', $3, $4)
        `, [auditId, id, JSON.stringify({ slotCode: c.slotCode, currentSemester: c.currentSemester }), now]);

        cohortMap[c.slotCode] = { id, currentSemester: c.currentSemester, slotCode: c.slotCode };
        console.log(`Created active cohort ${c.slotCode}: ${id} (Sem ${c.currentSemester})`);
      }
    }

    // 4. Create Permanent Chat Room for Each Active Cohort
    const roomMap = {}; // slotCode -> roomId
    for (const c of CANONICAL_COHORTS) {
      const cohort = cohortMap[c.slotCode];
      const existingRoom = await client.query(
        'SELECT * FROM chat_groups WHERE cohort_id = $1',
        [cohort.id]
      );
      if (existingRoom.rows.length > 0) {
        roomMap[c.slotCode] = existingRoom.rows[0].id;
        console.log(`Chat room for cohort ${c.slotCode} already exists: ${existingRoom.rows[0].id}`);
      } else {
        const roomId = crypto.randomUUID();
        const now = new Date().toISOString();
        await client.query(`
          INSERT INTO chat_groups (id, cohort_id, kind, status, created_at, realtime_epoch)
          VALUES ($1, $2, 'cohort', 'active', $3, 1)
        `, [roomId, cohort.id, now]);

        // Update or insert chat_group_slots
        await client.query(`
          INSERT INTO chat_group_slots (group_code, current_chat_group_id, version)
          VALUES ($1, $2, 1)
          ON CONFLICT (group_code) DO UPDATE
          SET current_chat_group_id = EXCLUDED.current_chat_group_id, version = chat_group_slots.version + 1
        `, [c.slotCode.toUpperCase(), roomId]);

        roomMap[c.slotCode] = roomId;
        console.log(`Created chat room for cohort ${c.slotCode}: ${roomId}`);
      }
    }

    // 5. Map Verified Students
    // Classification:
    // A. Verified regular BIT students matching active cohort:
    //    '26020260' (Sandesh Dhakal, BIT, Semester 1) -> Mercury UUID
    // B. Staff/Admin:
    //    '26020266' (admin) -> cohort_id = NULL
    //    'TEACHER_...' -> cohort_id = NULL
    // C. Ambiguous / unverified / fixtures:
    //    cohort_id = NULL
    let mappedCount = 0;
    const mercuryId = cohortMap['mercury'].id;
    const mapRes = await client.query(`
      UPDATE students
      SET cohort_id = $1
      WHERE studentid = '26020260' AND cohort_id IS NULL
    `, [mercuryId]);
    mappedCount += mapRes.rowCount;

    const staffRes = await client.query(`
      SELECT COUNT(*) AS c FROM students WHERE role IN ('admin', 'teacher')
    `);
    const unassignedRes = await client.query(`
      SELECT COUNT(*) AS c FROM students WHERE cohort_id IS NULL AND role NOT IN ('admin', 'teacher')
    `);

    console.log(`Student Mapping: Mapped=${mappedCount}, Staff=${staffRes.rows[0].c}, Unassigned=${unassignedRes.rows[0].c}`);

    // 6. Content Backfill
    // Files:
    // - without semester: audience_scope = 'all_students', semester_no = NULL, cohort_id = NULL
    // - with semester: audience_scope = 'all_students', semester_no = normalizeSemester(semester), cohort_id = NULL
    const filesRes = await client.query('SELECT id, semester FROM files');
    let filesUpdated = 0;
    for (const f of filesRes.rows) {
      const semNo = f.semester ? normalizeSemester(f.semester) : null;
      await client.query(`
        UPDATE files
        SET audience_scope = 'all_students', semester_no = $1
        WHERE id = $2 AND (audience_scope IS NULL OR audience_scope = '')
      `, [semNo, f.id]);
      filesUpdated++;
    }

    // Posts:
    // - audience_scope = 'all_students', cohort_id = NULL
    const postsRes = await client.query(`
      UPDATE posts
      SET audience_scope = 'all_students'
      WHERE audience_scope IS NULL OR audience_scope = ''
    `);

    // Assignments:
    // - Assignment 20: audience_scope = 'all_students', semester_no = 1, cohort_id = NULL
    const assignRes = await client.query(`
      UPDATE assignments
      SET audience_scope = 'all_students', semester_no = 1
      WHERE (audience_scope IS NULL OR audience_scope = '')
    `);

    console.log(`Content Backfill: Files=${filesUpdated}, Posts=${postsRes.rowCount}, Assignments=${assignRes.rowCount}`);

    // 7. Verify Invariants
    const activeCohorts = await client.query("SELECT slot_code, COUNT(*) AS c FROM cohorts WHERE status = 'active' GROUP BY slot_code HAVING COUNT(*) > 1");
    if (activeCohorts.rows.length > 0) {
      throw new Error('Invariant violation: Duplicate active slots detected');
    }

    const orphanStudents = await client.query("SELECT COUNT(*) AS c FROM students WHERE cohort_id IS NOT NULL AND cohort_id NOT IN (SELECT id FROM cohorts)");
    if (parseInt(orphanStudents.rows[0].c, 10) > 0) {
      throw new Error('Invariant violation: Orphan cohort_id on students');
    }

    const orphanRooms = await client.query("SELECT COUNT(*) AS c FROM chat_groups WHERE cohort_id IS NOT NULL AND cohort_id NOT IN (SELECT id FROM cohorts)");
    if (parseInt(orphanRooms.rows[0].c, 10) > 0) {
      throw new Error('Invariant violation: Orphan cohort_id on chat_groups');
    }

    await client.query('COMMIT');
    console.log('Transaction COMMITTED successfully.');

    // Final Report Summary
    const postStudents = await client.query('SELECT COUNT(*) AS c FROM students');
    const postCohorts = await client.query('SELECT id, slot_code, display_name, current_semester, status FROM cohorts ORDER BY current_semester');
    const postRooms = await client.query('SELECT id, cohort_id, group_code, status FROM chat_groups');

    console.log('\n--- PRODUCTION MIGRATION MANIFEST ---');
    console.log('Active Cohorts:');
    console.table(postCohorts.rows);
    console.log('Active Chat Rooms:');
    console.table(postRooms.rows);

    return {
      success: true,
      cohortMap,
      roomMap,
      counts: {
        mapped: mappedCount,
        staff: parseInt(staffRes.rows[0].c, 10),
        unassigned: parseInt(unassignedRes.rows[0].c, 10),
        totalStudents: parseInt(postStudents.rows[0].c, 10),
        files: filesUpdated,
        posts: postsRes.rowCount,
        assignments: assignRes.rowCount
      }
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction ROLLED BACK due to error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().then(result => {
    console.log('\nMigration complete:', JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
