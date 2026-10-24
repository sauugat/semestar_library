#!/usr/bin/env node
"use strict";

/**
 * Deploy-time Database Migration Script (scripts/migrate-schema.js)
 * Runs full schema initialization and safe index migrations once per deploy
 * on the direct (non-pooler) database connection.
 */
process.env.SEMESTER_DB_SKIP_INIT = "1";
const db = require("../db");

async function main() {
  const start = Date.now();
  console.log("[Migrate]: Running deploy-time schema & index migrations...");
  await db.initSchema();
  const elapsed = Date.now() - start;
  console.log(`[Migrate]: Schema & index migrations completed in ${elapsed}ms.`);
  await db.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[Migrate]: Fatal migration error:", err);
    process.exit(1);
  });
}

module.exports = { main };
