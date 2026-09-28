const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEBOUNCE_MS = parseInt(process.env.AUTO_SYNC_DEBOUNCE_MS || '10000', 10); // 10 seconds debounce
const IS_ONCE = process.argv.includes('--once');

// Patterns / paths to completely ignore from triggering commits
const IGNORE_PATTERNS = [
  /^\.git(\/|$)/,
  /^node_modules(\/|$)/,
  /^\.expo(\/|$)/,
  /^\.vscode(\/|$)/,
  /^uploads(\/|$)/,
  /^public\/uploads(\/|$)/,
  /^scratch(\/|$)/,
  /^mobile-test(\/|$)/,
  /\.DS_Store$/,
  /\.log$/,
  /database\.db/,
  /database\.db-journal/,
  /database\.db-wal/,
  /database\.db-shm/
];

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

function getChangedFiles() {
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf-8' });
    if (!status) return [];
    return status
      .split('\n')
      .filter(line => line.length > 3)
      .map(line => {
        const raw = line.slice(3).trim();
        return raw.includes(' -> ') ? raw.split(' -> ')[1] : raw;
      });
  } catch {
    return [];
  }
}

function shouldIgnore(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return IGNORE_PATTERNS.some(regex => regex.test(normalized));
}

let syncTimeout = null;
let isSyncing = false;
let queuedSync = false;

async function doSync(reason = '') {
  if (isSyncing) {
    queuedSync = true;
    return;
  }

  isSyncing = true;
  queuedSync = false;

  try {
    const changed = getChangedFiles();
    if (changed.length === 0) {
      if (IS_ONCE) {
        console.log(`[Auto-Sync ${new Date().toLocaleTimeString()}] Nothing to commit, working tree is clean.`);
      }
      isSyncing = false;
      return;
    }

    const branch = getCurrentBranch();
    console.log(`\n[Auto-Sync ${new Date().toLocaleTimeString()}] Detected changes in ${changed.length} file(s):`);
    changed.slice(0, 5).forEach(f => console.log(`  • ${f}`));
    if (changed.length > 5) {
      console.log(`  ... and ${changed.length - 5} more`);
    }

    // Stage changes
    console.log(`[Auto-Sync] Staging files with 'git add -A'...`);
    execSync('git add -A', { cwd: ROOT_DIR, stdio: 'inherit' });

    // Prepare commit message
    const summary = changed.length === 1 
      ? changed[0] 
      : `${changed.length} files (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '...' : ''})`;
    const commitMsg = `auto-sync: update ${summary} [${new Date().toISOString().replace('T', ' ').slice(0, 19)}]`;

    // Commit
    console.log(`[Auto-Sync] Committing: "${commitMsg}"...`);
    execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: ROOT_DIR, stdio: 'inherit' });

    // Push
    console.log(`[Auto-Sync] Pushing to origin/${branch}...`);
    execSync(`git push origin ${branch}`, { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log(`[Auto-Sync ${new Date().toLocaleTimeString()}] ✔ Successfully pushed to GitHub!\n`);
  } catch (err) {
    console.error(`[Auto-Sync Warning] Sync failed: ${err.message}`);
    console.log(`[Auto-Sync] Will retry automatically on next detected change.`);
  } finally {
    isSyncing = false;
    if (queuedSync) {
      queuedSync = false;
      setTimeout(() => doSync('queued changes'), 1000);
    }
  }
}

function scheduleSync(filePath) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  const relPath = path.relative(ROOT_DIR, filePath);
  console.log(`[Auto-Sync ${new Date().toLocaleTimeString()}] File change detected: ${relPath} (waiting ${DEBOUNCE_MS / 1000}s quiet period...)`);
  syncTimeout = setTimeout(() => {
    doSync(`file changed: ${relPath}`);
  }, DEBOUNCE_MS);
}

if (IS_ONCE) {
  doSync('one-shot manual run');
} else {
  console.log(`=======================================================`);
  console.log(`  🚀 Auto-Sync File Watcher is Active`);
  console.log(`  • Root: ${ROOT_DIR}`);
  console.log(`  • Branch: ${getCurrentBranch()}`);
  console.log(`  • Debounce: ${DEBOUNCE_MS / 1000}s`);
  console.log(`  • Auto-commit & push on every file save`);
  console.log(`=======================================================\n`);

  try {
    fs.watch(ROOT_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (shouldIgnore(filename)) return;
      scheduleSync(filename);
    });
  } catch (err) {
    console.error(`[Auto-Sync] Failed to start watcher on ${ROOT_DIR}:`, err);
    process.exit(1);
  }
}
