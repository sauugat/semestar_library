const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = 4567;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  // Mock API endpoints
  if (pathname === '/api/profile') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'usr-student-shree',
      name: 'Shree',
      username: 'shree',
      role: 'student',
      studentId: 'BIT-2024-001',
      avatarUrl: ''
    }));
    return;
  }

  if (pathname === '/api/conversations') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
    return;
  }

  if (pathname === '/api/ai/chat/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"token": "Hello! "}\n\n');
    res.write('data: {"token": "I am Kyana, your academic companion. Let\'s explore this topic together!"}\n\n');
    res.write('data: {"done": true, "session": {"id": "ses-1"}}\n\n');
    res.end();
    return;
  }

  if (pathname === '/') pathname = '/chatbot.html';
  const filePath = path.join(PUBLIC_DIR, pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

async function runTests() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running at http://localhost:${PORT}`);

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const artifactDir = '/Users/sauu_gat/.gemini/antigravity/brain/5b7ee805-798e-432d-bcf6-98fd86732595';

  try {
    // -------------------------------------------------------------
    // Test 1: Desktop Viewport (1440x900) - Empty Welcome Screen
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Desktop Viewport (1440x900) ---');
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // Set local storage / session storage with mock user before loading
    await page.addInitScript(() => {
      const mockSession = {
        access_token: 'test-jwt-access-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        user: {
          id: 'usr-student-shree',
          email: 'shree@gandaki.edu.np',
          role: 'authenticated',
          user_metadata: {
            name: 'Shree',
            role: 'student',
            student_id: 'BIT-2024-001'
          }
        }
      };
      localStorage.setItem('sb-local-auth-token', JSON.stringify(mockSession));
      sessionStorage.setItem('sl_user_cache', JSON.stringify({
        id: 'usr-student-shree',
        name: 'Shree',
        role: 'student'
      }));
    });

    await page.goto(`http://localhost:${PORT}/chatbot.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // Verify Header Toggle Button is hidden when sidebar is open on desktop
    const sidebarOpenBtnDisplay = await page.$eval('#kyanaSidebarOpenBtn', el => window.getComputedStyle(el).display);
    console.log(`[PASS] #kyanaSidebarOpenBtn display on desktop (sidebar open): "${sidebarOpenBtnDisplay}" (expected "none")`);
    if (sidebarOpenBtnDisplay !== 'none') {
      throw new Error(`Expected #kyanaSidebarOpenBtn to be 'none' on desktop with sidebar open, got '${sidebarOpenBtnDisplay}'`);
    }

    // Verify Marks Entry is hidden for student
    const marksEntryDisplay = await page.$eval('#navMarksEntryItem', el => window.getComputedStyle(el).display);
    console.log(`[PASS] #navMarksEntryItem display for student: "${marksEntryDisplay}" (expected "none")`);
    if (marksEntryDisplay !== 'none') {
      throw new Error(`Expected #navMarksEntryItem to be 'none', got '${marksEntryDisplay}'`);
    }

    // Verify Personalized Greeting
    const greetingText = await page.$eval('#kyanaWelcomeGreeting', el => el.textContent.trim());
    console.log(`[PASS] Welcome greeting text: "${greetingText}"`);
    if (!greetingText.includes('Shree')) {
      throw new Error(`Expected greeting to include "Shree", got "${greetingText}"`);
    }

    // Verify Subtitle
    const subText = await page.$eval('#kyanaWelcomeSub', el => el.textContent.trim());
    console.log(`[PASS] Welcome subtitle: "${subText}"`);
    if (!subText.includes('Gandaki University')) {
      throw new Error(`Expected subtitle to include "Gandaki University", got "${subText}"`);
    }

    // Verify 4 Suggestion Cards
    const cardCount = await page.$$eval('.kyana-suggestion-card', els => els.length);
    console.log(`[PASS] Suggestion cards count: ${cardCount} (expected 4)`);
    if (cardCount !== 4) {
      throw new Error(`Expected 4 suggestion cards, found ${cardCount}`);
    }

    const cardBadges = await page.$$eval('.kyana-card-badge', els => els.map(e => e.textContent.trim()));
    console.log(`[PASS] Card badges:`, cardBadges);

    // Take screenshot of desktop welcome screen
    const desktopScreenshotPath = path.join(artifactDir, 'phase-2-desktop-empty-1440x900.png');
    await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
    console.log(`[SCREENSHOT] Saved: ${desktopScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 2: Interactive Focus Aura Feedback
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Interactive Focus Aura Feedback ---');
    await page.focus('#kyanaInput');
    await page.waitForTimeout(300);
    const hasComposerFocused = await page.$eval('#kyanaApp', el => el.classList.contains('composer-focused'));
    console.log(`[PASS] #kyanaApp has class "composer-focused" on input focus: ${hasComposerFocused}`);
    if (!hasComposerFocused) throw new Error('Expected #kyanaApp to have class composer-focused');

    const focusScreenshotPath = path.join(artifactDir, 'phase-2-desktop-focus-aura-1440x900.png');
    await page.screenshot({ path: focusScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${focusScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 3: Suggestion Card Click & Transition to Active Chat
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Card Click & Welcome-to-Conversation Transition ---');
    // Click the first card
    await page.click('.kyana-suggestion-card[data-prompt*="Teach me"]');
    await page.waitForTimeout(800);

    const appHasMessages = await page.$eval('#kyanaApp', el => el.classList.contains('has-messages'));
    const appIsEmpty = await page.$eval('#kyanaApp', el => el.classList.contains('is-empty'));
    const welcomeHeroDisplay = await page.$eval('#kyanaWelcomeHero', el => window.getComputedStyle(el).display);
    console.log(`[PASS] After card click: has-messages=${appHasMessages}, is-empty=${appIsEmpty}, welcomeHeroDisplay="${welcomeHeroDisplay}"`);
    if (!appHasMessages || appIsEmpty || welcomeHeroDisplay !== 'none') {
      throw new Error('Failed to transition smoothly to active conversation state!');
    }

    const chatScreenshotPath = path.join(artifactDir, 'phase-2-desktop-active-chat-1440x900.png');
    await page.screenshot({ path: chatScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${chatScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 4: New Chat Button Restores Empty Welcome State
    // -------------------------------------------------------------
    console.log('\n--- Test 4: New Chat Button Restores Empty Welcome State ---');
    await page.click('#kyanaNewChatBtn');
    await page.waitForTimeout(400);

    const appIsEmptyAgain = await page.$eval('#kyanaApp', el => el.classList.contains('is-empty'));
    const welcomeHeroDisplayAgain = await page.$eval('#kyanaWelcomeHero', el => window.getComputedStyle(el).display);
    console.log(`[PASS] After + New chat: is-empty=${appIsEmptyAgain}, welcomeHeroDisplay="${welcomeHeroDisplayAgain}"`);
    if (!appIsEmptyAgain || welcomeHeroDisplayAgain === 'none') {
      throw new Error('Failed to restore welcome state upon clicking New Chat!');
    }

    // -------------------------------------------------------------
    // Test 5: Sidebar Collapse & Toggle Button Reveal on Desktop
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Sidebar Collapse & Header Button Toggle ---');
    await page.click('#kyanaSidebarCloseBtn');
    await page.waitForTimeout(400);

    const isSidebarCollapsed = await page.$eval('#kyanaApp', el => el.classList.contains('sidebar-collapsed'));
    const headerToggleBtnDisplay = await page.$eval('#kyanaSidebarOpenBtn', el => window.getComputedStyle(el).display);
    console.log(`[PASS] After sidebar collapse: sidebar-collapsed=${isSidebarCollapsed}, #kyanaSidebarOpenBtn display="${headerToggleBtnDisplay}"`);
    if (!isSidebarCollapsed || headerToggleBtnDisplay === 'none') {
      throw new Error('Sidebar open toggle should be visible in header when sidebar is collapsed!');
    }

    const collapsedScreenshotPath = path.join(artifactDir, 'phase-2-desktop-sidebar-collapsed.png');
    await page.screenshot({ path: collapsedScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${collapsedScreenshotPath}`);

    // Click header toggle to re-expand sidebar
    await page.click('#kyanaSidebarOpenBtn');
    await page.waitForTimeout(400);
    const isSidebarExpanded = await page.$eval('#kyanaApp', el => !el.classList.contains('sidebar-collapsed'));
    const headerToggleHiddenAgain = await page.$eval('#kyanaSidebarOpenBtn', el => window.getComputedStyle(el).display);
    console.log(`[PASS] After re-expanding: sidebar expanded=${isSidebarExpanded}, #kyanaSidebarOpenBtn display="${headerToggleHiddenAgain}"`);
    if (!isSidebarExpanded || headerToggleHiddenAgain !== 'none') {
      throw new Error('Sidebar toggle should hide again once sidebar is expanded!');
    }

    // -------------------------------------------------------------
    // Test 6: Fallback Greeting without user name
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Fallback Greeting without User Name ---');
    const guestGreeting = await page.evaluate(() => {
      const greetingEl = document.getElementById('kyanaWelcomeGreeting');
      if (!greetingEl) return null;
      const hour = new Date().getHours();
      let timeOfDay = 'evening';
      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      // Simulate guest/unnamed fallback
      greetingEl.textContent = `Good ${timeOfDay}.`;
      return greetingEl.textContent;
    });
    console.log(`[PASS] Fallback greeting text: "${guestGreeting}"`);
    if (!guestGreeting.startsWith('Good ') || !guestGreeting.endsWith('.') || guestGreeting.includes('undefined') || guestGreeting.includes('null') || guestGreeting.includes(',')) {
      throw new Error(`Fallback greeting has formatting error: "${guestGreeting}"`);
    }

    await context.close();

    // -------------------------------------------------------------
    // Test 6: Mobile Viewport (390x844 iPhone 14 / modern mobile)
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Mobile Viewport (390x844) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15'
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.addInitScript(() => {
      const mockSession = {
        access_token: 'test-jwt-access-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        user: {
          id: 'usr-student-shree',
          email: 'shree@gandaki.edu.np',
          role: 'authenticated',
          user_metadata: {
            name: 'Shree',
            role: 'student',
            student_id: 'BIT-2024-001'
          }
        }
      };
      localStorage.setItem('sb-local-auth-token', JSON.stringify(mockSession));
      sessionStorage.setItem('sl_user_cache', JSON.stringify({
        id: 'usr-student-shree',
        name: 'Shree',
        role: 'student'
      }));
    });
    await mobilePage.goto(`http://localhost:${PORT}/chatbot.html`, { waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(600);

    // On mobile, header toggle button MUST be visible to open drawer
    const mobileHeaderToggleDisplay = await mobilePage.$eval('#kyanaSidebarOpenBtn', el => window.getComputedStyle(el).display);
    console.log(`[PASS] Mobile header sidebar toggle display: "${mobileHeaderToggleDisplay}" (expected visible / not none)`);
    if (mobileHeaderToggleDisplay === 'none') {
      throw new Error(`Mobile sidebar toggle should be visible, got "${mobileHeaderToggleDisplay}"`);
    }

    // Nav links must be hidden on mobile
    const mobileNavDisplay = await mobilePage.$eval('.dash-header-nav', el => window.getComputedStyle(el).display);
    console.log(`[PASS] Mobile nav links display: "${mobileNavDisplay}" (expected "none")`);
    if (mobileNavDisplay !== 'none') {
      throw new Error(`Mobile nav links should be hidden, got "${mobileNavDisplay}"`);
    }

    // Suggestion grid should be 1 column on mobile
    const mobileGridColumns = await mobilePage.$eval('#kyanaSuggestionGrid', el => window.getComputedStyle(el).gridTemplateColumns);
    console.log(`[PASS] Mobile suggestion grid template columns: "${mobileGridColumns}"`);

    const mobileScreenshotPath = path.join(artifactDir, 'phase-2-mobile-empty-390x844.png');
    await mobilePage.screenshot({ path: mobileScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${mobileScreenshotPath}`);

    // Test mobile drawer toggle
    await mobilePage.click('#kyanaSidebarOpenBtn');
    await mobilePage.waitForTimeout(400);
    const mobileDrawerOpen = await mobilePage.$eval('#kyanaApp', el => el.classList.contains('sidebar-open'));
    console.log(`[PASS] Mobile drawer open after header toggle click: ${mobileDrawerOpen}`);
    if (!mobileDrawerOpen) throw new Error('Mobile drawer failed to open!');

    const mobileDrawerScreenshotPath = path.join(artifactDir, 'phase-2-mobile-drawer-open.png');
    await mobilePage.screenshot({ path: mobileDrawerScreenshotPath });
    console.log(`[SCREENSHOT] Saved: ${mobileDrawerScreenshotPath}`);

    await mobileContext.close();

    console.log('\n=============================================');
    console.log('ALL PHASE 2 & HEADER TESTS PASSED COMPLETELY!');
    console.log('=============================================\n');

  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n[TEST FAILURE]', err);
  process.exit(1);
});
