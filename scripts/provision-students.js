/**
 * scripts/provision-students.js
 *
 * Secure one-time server-side provisioning script to create Supabase Auth accounts
 * for existing students in Neon PostgreSQL.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-students.js [--file=emails.json]
 *
 * IMPORTANT:
 * - This script NEVER invents or generates fake email addresses.
 * - If students lack email addresses, it STOPS and reports the missing emails.
 * - Requires SUPABASE_SERVICE_ROLE_KEY (must never be committed or exposed to frontend).
 */

const path = require('path');
const fs = require('fs');
const db = require('../db');
const { getSupabaseConfig } = require('../lib/supabase');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  console.log('====================================================');
  console.log('  Semester Library — Supabase Auth Student Provisioning');
  console.log('====================================================\n');

  const { url } = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('❌ Error: Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
    process.exit(1);
  }

  if (!serviceRoleKey) {
    console.error('❌ Error: Missing SUPABASE_SERVICE_ROLE_KEY.');
    console.error('   Please run with: SUPABASE_SERVICE_ROLE_KEY=your_service_role_key node scripts/provision-students.js');
    console.error('   (Find your service_role secret key in Supabase Dashboard -> Project Settings -> API -> Project API Keys)');
    process.exit(1);
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await db.initSchema();

  // Optional: load emails mapping from a JSON file if provided (--file=emails.json)
  const fileArg = process.argv.find(arg => arg.startsWith('--file='));
  let emailOverrides = {};
  if (fileArg) {
    const filePath = path.resolve(fileArg.split('=')[1]);
    if (fs.existsSync(filePath)) {
      console.log(`📁 Loading student emails from: ${filePath}`);
      emailOverrides = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }

  // 1. Fetch all existing students from Neon PostgreSQL / local DB
  const students = await db.all('SELECT studentId, name, role, email, supabase_uid FROM students ORDER BY studentId ASC');

  if (!students || students.length === 0) {
    console.log('No students found in the database.');
    process.exit(0);
  }

  console.log(`Found ${students.length} student(s) in the database.\n`);

  // 2. Check for missing email addresses
  const missingEmails = [];
  for (const s of students) {
    const studentEmail = (emailOverrides[s.studentId] || s.email || '').trim();
    if (!studentEmail) {
      missingEmails.push(s);
    }
  }

  if (missingEmails.length > 0) {
    console.error(`🚨 STOP: ${missingEmails.length} student(s) do NOT have an email address registered:`);
    missingEmails.slice(0, 10).forEach(s => {
      console.error(`   • Student ID: ${s.studentId} | Name: ${s.name} | Role: ${s.role}`);
    });
    if (missingEmails.length > 10) {
      console.error(`   ... and ${missingEmails.length - 10} more`);
    }
    console.error('\nPer strict policy, fake/placeholder email addresses are NOT created automatically.');
    console.error('Please provide a mapping file containing real student emails:');
    console.error('Example emails.json format:');
    console.error('{\n  "26020266": "saugat@example.com",\n  "26020230": "aashrita@example.com"\n}');
    console.error('\nThen re-run:');
    console.error('SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-students.js --file=emails.json');
    process.exit(1);
  }

  console.log('✔ All students have valid email addresses. Proceeding to provision Supabase Auth accounts...\n');

  let provisioned = 0;
  let alreadyLinked = 0;
  let failed = 0;

  for (const s of students) {
    const email = (emailOverrides[s.studentId] || s.email).trim().toLowerCase();

    // Check if student already has a supabase_uid linked
    if (s.supabase_uid) {
      console.log(`ℹ️ [Skipped] ${s.studentId} (${s.name}) already linked to Supabase UID: ${s.supabase_uid}`);
      alreadyLinked++;
      continue;
    }

    try {
      // Create user in Supabase Auth via Admin API (email_confirm: true bypasses email verification)
      const initialPassword = process.env.DEFAULT_INITIAL_PASSWORD || `Student#${s.studentId}`;
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: {
          student_id: s.studentId,
          name: s.name,
        },
      });

      let supabaseUid = null;

      if (error) {
        // If user already exists in Supabase Auth, lookup by email
        if (error.message.includes('already registered') || error.status === 422) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
          const existingUser = listData.users.find(u => u.email.toLowerCase() === email);
          if (existingUser) {
            supabaseUid = existingUser.id;
            console.log(`ℹ️ User already in Supabase Auth for ${email}, matched UID: ${supabaseUid}`);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      } else {
        supabaseUid = data.user.id;
      }

      // Link Supabase UID and email in Neon database
      await db.run(
        'UPDATE students SET supabase_uid = ?, email = ? WHERE studentId = ?',
        supabaseUid, email, s.studentId
      );

      console.log(`✔ Provisioned ${s.studentId} (${s.name}) -> ${email} (UID: ${supabaseUid})`);
      provisioned++;
    } catch (err) {
      console.error(`❌ Failed to provision ${s.studentId} (${s.name}):`, err.message);
      failed++;
    }
  }

  console.log('\n====================================================');
  console.log('  Provisioning Summary');
  console.log('====================================================');
  console.log(`  • Newly provisioned & linked: ${provisioned}`);
  console.log(`  • Already linked:             ${alreadyLinked}`);
  console.log(`  • Failed:                     ${failed}`);
  console.log(`  • Total students:             ${students.length}`);
  console.log('====================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
