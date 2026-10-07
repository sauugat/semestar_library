#!/usr/bin/env node
'use strict';

/**
 * Administrative CLI Script: Pre-provision Teacher Accounts.
 *
 * SAFETY RULES:
 * 1. Default mode is DRY-RUN. Database is NOT mutated unless `--apply` is explicitly passed.
 * 2. Plaintext passwords are NEVER stored in the database (bcrypt hash only).
 * 3. Output files for one-time credential distribution MUST NOT reside inside the Git repository worktree.
 * 4. Passwords have at least 96 bits of cryptographic entropy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  DEFAULT_INVITE_EXPIRY_DAYS,
  RESERVED_USERNAMES
} = require('../lib/teacher-service');

function parseArgs(argv) {
  const args = {
    count: 50,
    apply: false,
    dryRun: true,
    output: null,
    prefix: 'teacher',
    expiryDays: DEFAULT_INVITE_EXPIRY_DAYS
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (arg === '--count' && argv[i + 1]) {
      args.count = parseInt(argv[++i], 10) || 50;
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--prefix' && argv[i + 1]) {
      args.prefix = argv[++i];
    } else if (arg === '--expiry-days' && argv[i + 1]) {
      args.expiryDays = parseInt(argv[++i], 10) || DEFAULT_INVITE_EXPIRY_DAYS;
    }
  }

  return args;
}

/**
 * Generates high-entropy password (96+ bits of entropy).
 * Uses crypto.randomBytes(12) producing 16 characters base64url.
 */
function generateSecurePassword() {
  const bytes = crypto.randomBytes(12);
  return bytes.toString('base64url');
}

/**
 * Validates that an output file path does not reside inside the Git repository worktree.
 */
function validateOutputPathOutsideRepo(outputPath) {
  const repoRoot = path.resolve(__dirname, '..');
  const resolvedOut = path.resolve(outputPath);

  if (resolvedOut === repoRoot || resolvedOut.startsWith(repoRoot + path.sep)) {
    throw new Error(
      `SECURITY ERROR: Output destination "${outputPath}" is inside the repository worktree.\n` +
      `Credential exports must be written to an external, secure location (e.g. ~/Desktop/teacher-credentials.csv).`
    );
  }

  return resolvedOut;
}

async function runProvisioning(customOptions = null) {
  const options = customOptions
    ? {
        count: 50,
        apply: false,
        dryRun: true,
        output: null,
        prefix: 'teacher',
        expiryDays: DEFAULT_INVITE_EXPIRY_DAYS,
        ...customOptions
      }
    : parseArgs(process.argv);
  await db.initSchema();

  console.log('================================================================');
  console.log('SEMESTER LIBRARY — TEACHER ACCOUNT PROVISIONING');
  console.log('================================================================');
  console.log(`Requested Count : ${options.count}`);
  console.log(`Mode            : ${options.apply ? 'APPLY (MUTATING DATABASE)' : 'DRY-RUN (NO CHANGES)'}`);
  console.log(`Invite Expiry   : ${options.expiryDays} days`);
  console.log('----------------------------------------------------------------');

  let resolvedOutputFile = null;
  if (options.output) {
    resolvedOutputFile = validateOutputPathOutsideRepo(options.output);
    console.log(`Output Target   : ${resolvedOutputFile}`);
  }

  // 1. Scan existing usernames in both students and teacher_invites to prevent collisions
  const existingStudents = await db.all('SELECT LOWER(username) AS u, LOWER(studentId) AS sid FROM students');
  const existingInvites = await db.all('SELECT LOWER(initial_username) AS u FROM teacher_invites');

  const takenUsernames = new Set();
  for (const s of existingStudents) {
    if (s.u) takenUsernames.add(s.u.toLowerCase());
    if (s.sid) takenUsernames.add(s.sid.toLowerCase());
  }
  for (const inv of existingInvites) {
    if (inv.u) takenUsernames.add(inv.u.toLowerCase());
  }
  for (const reserved of RESERVED_USERNAMES) {
    takenUsernames.add(reserved);
  }

  // 2. Deterministically generate collision-free usernames and cryptographically secure passwords
  const generatedAccounts = [];
  let candidateNum = 1;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.expiryDays * 24 * 60 * 60 * 1000).toISOString();

  while (generatedAccounts.length < options.count) {
    const pad = String(candidateNum).padStart(3, '0');
    const candidateUsername = `${options.prefix}${pad}`.toLowerCase();

    if (!takenUsernames.has(candidateUsername)) {
      takenUsernames.add(candidateUsername);
      const plaintextPassword = generateSecurePassword();
      const passwordHash = bcrypt.hashSync(plaintextPassword, 12);
      const inviteId = crypto.randomUUID();

      generatedAccounts.push({
        id: inviteId,
        username: candidateUsername,
        plaintextPassword,
        passwordHash,
        expiresAt
      });
    }

    candidateNum++;
    if (candidateNum > options.count + 5000) {
      throw new Error('Too many candidate username collisions encountered.');
    }
  }

  console.log(`Candidate accounts generated: ${generatedAccounts.length}`);
  console.log(`First account candidate    : ${generatedAccounts[0].username}`);
  console.log(`Last account candidate     : ${generatedAccounts[generatedAccounts.length - 1].username}`);

  if (options.dryRun) {
    console.log('\n✔ DRY-RUN COMPLETE: No rows were inserted into the database.');
    console.log('To apply this provisioning, run with `--apply`:');
    console.log(`  node scripts/provision-teachers.js --count ${options.count} --apply`);
    return { success: true, dryRun: true, count: generatedAccounts.length };
  }

  // 3. APPLY: Insert records into teacher_invites
  console.log('\nInserting provisioned records into database...');
  let inserted = 0;

  for (const acc of generatedAccounts) {
    if (db.isPostgres) {
      await db.run(
        `INSERT INTO teacher_invites (
          id, initial_username, temporary_password_hash, status, expires_at
        ) VALUES ($1, $2, $3, 'provisioned', $4)`,
        acc.id,
        acc.username,
        acc.passwordHash,
        acc.expiresAt
      );
    } else {
      await db.run(
        `INSERT INTO teacher_invites (
          id, initial_username, temporary_password_hash, status, expires_at
        ) VALUES (?, ?, ?, 'provisioned', ?)`,
        acc.id,
        acc.username,
        acc.passwordHash,
        acc.expiresAt
      );
    }
    inserted++;
  }

  console.log(`✔ SUCCESS: ${inserted} teacher invites inserted into database.`);

  // 4. Output plaintext credentials to external secure file if requested
  if (resolvedOutputFile) {
    const header = 'id,initial_username,temporary_password,expires_at\n';
    const rows = generatedAccounts.map(
      a => `${a.id},${a.username},${a.plaintextPassword},${a.expiresAt}`
    ).join('\n');

    fs.writeFileSync(resolvedOutputFile, header + rows, {
      encoding: 'utf8',
      mode: 0o600 // Restrictive permissions (owner read/write only)
    });

    console.log(`✔ Plaintext credentials saved for one-time admin distribution at:\n  ${resolvedOutputFile}`);
  }

  return { success: true, applied: true, count: inserted };
}

if (require.main === module) {
  runProvisioning()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n✖ Provisioning error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  runProvisioning,
  parseArgs,
  generateSecurePassword,
  validateOutputPathOutsideRepo
};
