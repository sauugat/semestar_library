'use strict';

/**
 * Phase 4D.3: Safe Local QA Server Launcher
 *
 * Dedicated startup command: npm run qa:server
 *
 * Enforces fail-closed production isolation, prepares disposable local database,
 * seeds synthetic test accounts, starts the backend on 0.0.0.0:3000, and displays
 * exact LAN connection URLs for the user's Android Expo Development Client.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// 1. Enforce isolated QA environment variables BEFORE importing db or server
if (!process.env.QA_MODE) process.env.QA_MODE = 'true';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'qa';
if (!process.env.DB_PATH) process.env.DB_PATH = path.join(__dirname, '..', 'database.qa.db');
if (!process.env.EXPO_PUSH_DISABLED) process.env.EXPO_PUSH_DISABLED = 'true';
if (!process.env.TEACHER_ONBOARDING_ENABLED) process.env.TEACHER_ONBOARDING_ENABLED = 'false';
if (!process.env.DM_ENABLED) process.env.DM_ENABLED = 'false';

// Strip any external/production secrets from memory to prevent accidental calls
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGHOST;
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENROUTER_API_KEY;

// 2. Run fail-closed QA safety guard
const { assertSafeQaEnvironment } = require('../lib/qa-guard');
assertSafeQaEnvironment();

const db = require('../db');
const { seedQa } = require('./seed-qa');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        // Prioritize Wi-Fi / en0 interfaces
        if (name === 'en0' || name.startsWith('wl') || name.startsWith('wi')) {
          candidates.unshift(net.address);
        } else {
          candidates.push(net.address);
        }
      }
    }
  }
  return candidates[0] || '127.0.0.1';
}

async function startQaServer() {
  const isReset = process.argv.includes('--reset');
  const forceSeed = process.argv.includes('--seed');

  if (isReset) {
    const qaDbPath = process.env.DB_PATH;
    if (fs.existsSync(qaDbPath)) {
      console.log(`[QA Reset]: Removing existing QA database at ${qaDbPath}...`);
      fs.unlinkSync(qaDbPath);
    }
  }

  // Check if test accounts exist
  let shouldSeed = forceSeed || isReset;
  if (!shouldSeed) {
    try {
      const existing = await db.get("SELECT studentId FROM students WHERE studentId = 'qa_admin'");
      if (!existing) {
        shouldSeed = true;
      }
    } catch {
      shouldSeed = true;
    }
  }

  if (shouldSeed) {
    console.log('[QA Launcher]: Initializing and seeding synthetic test accounts...');
    await seedQa(db);
  } else {
    console.log('[QA Launcher]: Disposable test database already seeded. Skipping initial seed.');
  }

  // Import server after environment and DB are fully verified
  const app = require('../server');
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const lanIp = getLocalIpAddress();

  const server = app.server || app.listen(PORT, HOST);

  // If app.server was already created in server.js, listen on it
  if (!server.listening) {
    server.listen(PORT, HOST, () => {
      printBanner(lanIp, PORT);
    });
  } else {
    printBanner(lanIp, PORT);
  }

  // Graceful shutdown
  const handleShutdown = () => {
    console.log('\n[QA Server]: Shutting down cleanly...');
    server.close(() => {
      console.log('[QA Server]: Stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

function printBanner(lanIp, port) {
  const lanUrl = `http://${lanIp}:${port}`;
  console.log(`
====================================================================
 🚀 SEMESTER LIBRARY — ISOLATED LOCAL QA ENVIRONMENT READY
====================================================================
 [Security & Isolation Guarantees]:
   ✔ Production Neon PostgreSQL: BLOCKED & ISOLATED
   ✔ Production Supabase: BLOCKED & ISOLATED
   ✔ Push Notifications: MOCKED (No live notifications to devices)
   ✔ External AI Services: MOCKED / DISABLED
   ✔ Database: Disposable SQLite (${path.basename(process.env.DB_PATH)})
   ✔ Teacher Onboarding: DISABLED

 [Network Interfaces]:
   • Localhost: http://localhost:${port}
   • LAN URL:   ${lanUrl}

 [Synthetic Test Accounts (Passwords for all: <Username>123!)]:
   • Admin:   qa_admin   | QaAdmin123!   (Dashboard, Users, Academics, Content, Profile)
   • Student: qa_student | QaStudent123! (Home, Library, Chat, Games, Profile)
   • CR:      qa_cr      | QaCr123!      (Home, Library, Chat, Games, Profile)
   • Teacher: qa_teacher | QaTeacher123! (Dashboard, My Materials, Chat, Notices, Profile)

 [To Connect Your Android Phone (Expo Dev Client)]:
   1. Ensure phone & MacBook are on the SAME Wi-Fi network.
   2. In Terminal 2, start Expo Metro:
      EXPO_PUBLIC_API_URL=${lanUrl} npm run start -- --host lan
   3. Open the "Semester Library" Expo Dev Client on your phone.
   4. Connect to the Metro bundler.
====================================================================
`);
}

startQaServer().catch(err => {
  console.error('[QA Launcher Fatal Error]:', err.message);
  process.exit(1);
});
