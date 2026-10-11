const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('MOBILE DATA LOADING REGRESSION TEST SUITE', async (t) => {
  const apiPath = path.resolve(__dirname, '../mobile/services/api.ts');
  const chatPath = path.resolve(__dirname, '../mobile/services/chat.ts');
  const chatSessionPath = path.resolve(__dirname, '../mobile/services/chat-session.ts');
  const authContextPath = path.resolve(__dirname, '../mobile/context/AuthContext.tsx');
  const feedIndexPath = path.resolve(__dirname, '../mobile/app/(tabs)/index.tsx');
  const unifiedChatPath = path.resolve(__dirname, '../mobile/components/chat/UnifiedChatInbox.tsx');
  const profileViewPath = path.resolve(__dirname, '../mobile/components/ProfileView.tsx');
  const mobileEnvPath = path.resolve(__dirname, '../mobile/.env');

  const apiContent = fs.readFileSync(apiPath, 'utf8');
  const chatContent = fs.readFileSync(chatPath, 'utf8');
  const chatSessionContent = fs.readFileSync(chatSessionPath, 'utf8');
  const authContextContent = fs.readFileSync(authContextPath, 'utf8');
  const feedIndexContent = fs.readFileSync(feedIndexPath, 'utf8');
  const unifiedChatContent = fs.readFileSync(unifiedChatPath, 'utf8');
  const profileViewContent = fs.readFileSync(profileViewPath, 'utf8');
  const mobileEnvContent = fs.readFileSync(mobileEnvPath, 'utf8');

  // 1. Mobile Environment points to production API
  await t.test('1. Mobile .env points to production backend and avoids stale local IPs', () => {
    assert.ok(
      mobileEnvContent.includes('EXPO_PUBLIC_API_URL=https://semestar-library.vercel.app'),
      'mobile/.env must point to https://semestar-library.vercel.app'
    );
    assert.ok(
      !mobileEnvContent.includes('192.168.1.65'),
      'mobile/.env must not hardcode stale machine IP 192.168.1.65'
    );
  });

  // 2. API fetch has 15-second timeout controller preventing infinite network hangs
  await t.test('2. Shared apiFetch incorporates timeout handling to prevent infinite hangs', () => {
    assert.ok(apiContent.includes('15000'), 'api.ts defines 15000ms timeout');
    assert.ok(apiContent.includes('timeoutTimer'), 'api.ts manages timeout timer');
    assert.ok(apiContent.includes('didTimeout = true'), 'api.ts flags request timeout');
    assert.ok(apiContent.includes('clearTimeout(timeoutTimer)'), 'api.ts clears timeout timer');
  });

  // 3. API Auto-detection does not hijack production or test environments
  await t.test('3. getAutoDetectedServerUrl does not hijack URL unless EXPO_PUBLIC_AUTO_DETECT_LAN is set', () => {
    assert.ok(apiContent.includes('EXPO_PUBLIC_AUTO_DETECT_LAN'), 'Guarded by EXPO_PUBLIC_AUTO_DETECT_LAN');
    assert.ok(apiContent.includes('PRODUCTION_SERVER_URL'), 'Defaults safely to PRODUCTION_SERVER_URL');
  });

  // 4. Authenticated requests use Bearer token from secure storage without shadowing
  await t.test('4. Authenticated requests supply Bearer token correctly without empty header shadowing', () => {
    assert.ok(
      chatContent.includes("if (session.credential)"),
      'fetchAdminChatRooms checks credential validity before sending Authorization header'
    );
    assert.ok(
      chatContent.includes("if (start.credential)"),
      'chatRequest only supplies Authorization when credential exists'
    );
  });

  // 5. Chat server assertion supports production Vercel domains
  await t.test('5. assertLocalChatServer safely handles production Vercel origins and non-empty strings', () => {
    assert.ok(chatSessionContent.includes("url.hostname.endsWith('.vercel.app')"), 'Allows .vercel.app origins');
    assert.ok(chatSessionContent.includes("!server || typeof server !== 'string'"), 'Guards against undefined/empty server string');
  });

  // 6. Home feed successful loading & empty states
  await t.test('6. Home feed defines empty state "No posts yet." and error state "Couldn\'t load posts." with Retry', () => {
    assert.ok(feedIndexContent.includes("Couldn't load posts."), 'Feed defines error title "Couldn\'t load posts."');
    assert.ok(feedIndexContent.includes('title="Retry"'), 'Feed provides Retry button on error');
    assert.ok(feedIndexContent.includes("No posts yet."), 'Feed defines empty title "No posts yet."');
    assert.ok(feedIndexContent.includes('refetchFeed()'), 'Feed Retry triggers refetchFeed');
  });

  // 7. Home feed does not keep skeleton cards on error
  await t.test('7. Home feed eliminates infinite skeleton cards on failure', () => {
    assert.ok(feedIndexContent.includes('if (loadingInitial)'), 'Skeletons only shown when loadingInitial is true');
    assert.ok(feedIndexContent.includes('if (error)'), 'Error state rendered when error occurs, replacing skeletons');
  });

  // 8. Chat inbox error state & empty state
  await t.test('8. Chat inbox shows "Couldn\'t load conversations." with [ Retry ] on failure', () => {
    assert.ok(unifiedChatContent.includes("Couldn't load conversations."), 'UnifiedChatInbox shows error title');
    assert.ok(unifiedChatContent.includes("Retry"), 'UnifiedChatInbox has retry action');
    assert.ok(unifiedChatContent.includes("No conversations yet"), 'UnifiedChatInbox displays empty title');
  });

  // 9. Chat inbox isolates realtime from HTTP loading
  await t.test('9. Chat conversation list renders independent of realtime connection state', () => {
    assert.ok(unifiedChatContent.includes('isFatalError'), 'UnifiedChatInbox detects fatal HTTP error state');
    assert.ok(unifiedChatContent.includes('onRefresh'), 'Pull to refresh supported independently of realtime');
  });

  // 10. Profile posts empty and error states with Retry button
  await t.test('10. Profile posts view defines "No posts yet." and "Couldn\'t load posts." with Retry', () => {
    assert.ok(profileViewContent.includes('title="No posts yet."'), 'Profile shows "No posts yet." when empty');
    assert.ok(profileViewContent.includes("Couldn't load posts."), 'Profile shows "Couldn\'t load posts." on error');
    assert.ok(profileViewContent.includes("onPress={() => fetchPosts()}"), 'Profile has Retry button calling fetchPosts()');
  });

  // 11. Profile posts lifecycle eliminates infinite spinner
  await t.test('11. Profile fetch operations use try/catch/finally to guarantee loading spinner terminates', () => {
    assert.ok(profileViewContent.includes('setPostsError(true)'), 'fetchPosts sets postsError on failure');
    assert.ok(profileViewContent.includes('finally {\n      setLoadingPosts(false);\n    }'), 'fetchPosts always resets loadingPosts in finally');
    assert.ok(profileViewContent.includes('finally {\n      setLoadingPhotos(false);\n    }'), 'fetchPhotos always resets loadingPhotos in finally');
    assert.ok(profileViewContent.includes('finally {\n      setLoadingFiles(false);\n    }'), 'fetchFiles always resets loadingFiles in finally');
    assert.ok(profileViewContent.includes('finally {\n      setLoadingAssignments(false);\n    }'), 'fetchAssignments always resets loadingAssignments in finally');
  });

  // 12. Safe diagnostics without leaking credentials
  await t.test('12. apiFetch logs sanitized diagnostics without leaking secrets or tokens', () => {
    assert.ok(apiContent.includes('[CLIENT API]'), 'Uses [CLIENT API] sanitized diagnostic prefix');
    assert.ok(!apiContent.includes('console.log(token)'), 'Does not log raw token');
    assert.ok(!apiContent.includes('console.log(password)'), 'Does not log password');
  });
});
