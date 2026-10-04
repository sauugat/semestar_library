#!/usr/bin/env node
'use strict';

// Deliberately does not import db.js/server.js, load .env, connect to a service,
// initialize a schema, or assign students/messages. Accept local SQLite only.
const { DatabaseSync } = require('node:sqlite');
const { resolve } = require('node:path');

const quote = value => `"${value.replaceAll('"', '""')}"`;
const INITIAL_CODES = Object.freeze({ 1: 'MERCURY', 3: 'VENUS', 5: 'EARTH', 7: 'MARS' });

function auditLocalChat(filename) {
  if (typeof filename !== 'string' || !filename || filename === ':memory:' ||
      /^[a-z][a-z\d+.-]*:/i.test(filename)) {
    throw new Error('Provide an existing local SQLite file path; URLs are not supported.');
  }
  const db = new DatabaseSync(resolve(filename), { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN;');
    const allTables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const selected = allTables.filter(name => /^(students$|chat_|push_|notifications$|file_blobs$)|cohort|membership|batch/i.test(name));
    const tables = Object.fromEntries(selected.map(name => [name, {
      columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name),
      count: Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n),
    }]));
    const columns = name => (tables[name]?.columns || []).map(column => column.toLowerCase());
    const blockers = [];
    if (!tables.students || !tables.chat_messages) blockers.push('REQUIRED_TABLES_MISSING');
    const messageColumns = columns('chat_messages');
    const persistedRoomIdentity = messageColumns.includes('chat_group_id');
    if (!persistedRoomIdentity) blockers.push('NO_PERSISTED_MESSAGE_ROOM_ID');
    const studentColumns = columns('students');
    if (!studentColumns.includes('cohort_id')) blockers.push('NO_PERSISTED_STUDENT_COHORT_ID');

    let assignmentSummary = [];
    if (['department', 'semester'].every(column => studentColumns.includes(column))) {
      assignmentSummary = db.prepare('SELECT department, semester, COUNT(*) AS count FROM students GROUP BY department, semester ORDER BY department, semester').all().map(row => {
        const department = String(row.department || '').trim().toUpperCase();
        const match = /^(?:Semester\s+)?([1-8])$/i.exec(String(row.semester || '').trim());
        // Candidates only. Current semester is never historical membership proof.
        const candidateCode = department === 'BIT' && match ? INITIAL_CODES[Number(match[1])] || null : null;
        return { department: row.department, semester: row.semester, count: Number(row.count), candidateCode, requiresRosterReview: true };
      });
      if (assignmentSummary.some(row => !row.candidateCode)) blockers.push('STUDENTS_OUTSIDE_INITIAL_BIT_MAPPING');
    } else blockers.push('ASSIGNMENT_COLUMNS_MISSING');
    // Columns (even if present in a newer schema) cannot prove provenance or
    // validate the production roster. This audit can never authorize cutover.
    if ((tables.chat_messages?.count || 0) > 0) blockers.push('HISTORICAL_OWNERSHIP_REQUIRES_VERIFIED_PROVENANCE');
    blockers.push('PRODUCTION_SCHEMA_ROSTER_AND_HISTORY_POLICY_NOT_VERIFIED');
    return {
      source: 'local SQLite snapshot; not production verification',
      readyForProductionMigration: false,
      historicalOwnership: 'NOT_PROVEN',
      persistedMessageRoomIdentity: persistedRoomIdentity,
      tables,
      assignmentSummary,
      blockers,
      notice: 'Read-only audit. No assignments or migrations performed. Never split legacy messages by current sender semester.',
    };
  } finally {
    db.close(); // Closing also ends the read transaction.
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/audit-cohort-chat.js /path/to/local-snapshot.db');
    console.log(JSON.stringify(auditLocalChat(process.argv[2]), null, 2));
    process.exitCode = 2; // Expected: review is required, never a migration approval.
  } catch (error) {
    console.error(`Audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { auditLocalChat };
