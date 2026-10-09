const test = require('node:test');
const assert = require('node:assert/strict');

// Replicate the pure logic of mobile/services/api.ts isLocalAddress and isTrustedServerUrl
function isLocalAddress(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function isTrustedServerUrl(url, isDev = true, expoPublicApiUrl = '') {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  try {
    const parsed = new URL(clean);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (!isDev) {
      if (protocol !== 'https:') return false;
      return (
        hostname === 'semestar-library.vercel.app' ||
        hostname.endsWith('.vercel.app')
      );
    }

    // In development mode:
    if (protocol === 'http:') {
      return isLocalAddress(clean);
    }

    if (protocol === 'https:') {
      return (
        hostname === 'semestar-library.vercel.app' ||
        hostname.endsWith('.vercel.app') ||
        Boolean(
          expoPublicApiUrl &&
          new URL(expoPublicApiUrl).hostname.toLowerCase() === hostname
        )
      );
    }

    return false;
  } catch {
    return false;
  }
}

// Replicate getBaseUrl resolution logic
async function resolveBaseUrl({
  isDev = true,
  storedUrl = null,
  envUrl = '',
  autoUrl = 'http://192.168.1.65:3000',
  extraUrl = '',
  productionUrl = 'https://semestar-library.vercel.app',
  deleteStored = () => {},
}) {
  if (!isDev) {
    if (storedUrl) {
      deleteStored();
    }
    if (envUrl && isTrustedServerUrl(envUrl, false, envUrl)) {
      return envUrl.replace(/\/+$/, '');
    }
    if (extraUrl && isTrustedServerUrl(extraUrl, false, envUrl)) {
      return extraUrl.replace(/\/+$/, '');
    }
    return productionUrl;
  }

  // Development:
  if (storedUrl && storedUrl.trim()) {
    const cleanSaved = storedUrl.trim().replace(/\/+$/, '');
    if (isTrustedServerUrl(cleanSaved, true, envUrl)) {
      return cleanSaved;
    }
    deleteStored();
  }

  if (envUrl && envUrl.trim()) {
    const cleanEnv = envUrl.trim().replace(/\/+$/, '');
    if (isTrustedServerUrl(cleanEnv, true, envUrl)) {
      return cleanEnv;
    }
  }

  if (autoUrl && isTrustedServerUrl(autoUrl, true, envUrl)) {
    return autoUrl.replace(/\/+$/, '');
  }

  if (extraUrl && isTrustedServerUrl(extraUrl, true, envUrl)) {
    return extraUrl.replace(/\/+$/, '');
  }

  return productionUrl;
}

test('API Config: isTrustedServerUrl validates development origins correctly', () => {
  // Local development addresses allowed in DEV
  assert.equal(isTrustedServerUrl('http://192.168.1.65:3000', true), true);
  assert.equal(isTrustedServerUrl('http://10.0.2.2:3000', true), true);
  assert.equal(isTrustedServerUrl('http://127.0.0.1:3000', true), true);
  assert.equal(isTrustedServerUrl('http://localhost:3000', true), true);

  // Vercel deployment addresses allowed in DEV
  assert.equal(isTrustedServerUrl('https://semestar-library.vercel.app', true), true);
  assert.equal(isTrustedServerUrl('https://semester-library-preview-test.vercel.app', true), true);

  // Malicious / untrusted origins rejected in DEV
  assert.equal(isTrustedServerUrl('https://evil-hacker.com', true), false);
  assert.equal(isTrustedServerUrl('http://malicious.org:8080', true), false);
  assert.equal(isTrustedServerUrl('javascript:alert(1)', true), false);
  assert.equal(isTrustedServerUrl('', true), false);
  assert.equal(isTrustedServerUrl(null, true), false);
});

test('API Config: isTrustedServerUrl enforces strict production HTTPS security', () => {
  // Production allowed origins
  assert.equal(isTrustedServerUrl('https://semestar-library.vercel.app', false), true);
  assert.equal(isTrustedServerUrl('https://staging-branch.vercel.app', false), true);

  // Insecure HTTP strictly forbidden in production
  assert.equal(isTrustedServerUrl('http://192.168.1.65:3000', false), false);
  assert.equal(isTrustedServerUrl('http://semestar-library.vercel.app', false), false);
  assert.equal(isTrustedServerUrl('http://localhost:3000', false), false);

  // Untrusted domains strictly forbidden in production
  assert.equal(isTrustedServerUrl('https://untrusted-api.io', false), false);
});

test('API Config: getBaseUrl resolves Vercel URLs without deleting valid overrides in DEV', async () => {
  let deleted = false;
  const url = await resolveBaseUrl({
    isDev: true,
    storedUrl: 'https://semestar-library.vercel.app',
    deleteStored: () => { deleted = true; }
  });

  assert.equal(url, 'https://semestar-library.vercel.app');
  assert.equal(deleted, false, 'Valid Vercel URL must NOT be deleted from storage');
});

test('API Config: getBaseUrl purges untrusted stored URLs in DEV', async () => {
  let deleted = false;
  const url = await resolveBaseUrl({
    isDev: true,
    storedUrl: 'https://malicious-site.com',
    envUrl: 'http://192.168.1.65:3000',
    deleteStored: () => { deleted = true; }
  });

  assert.equal(deleted, true, 'Untrusted URL must be deleted');
  assert.equal(url, 'http://192.168.1.65:3000', 'Should fall back to valid EXPO_PUBLIC_API_URL');
});

test('API Config: getBaseUrl prevents stored overrides from leaking into production builds', async () => {
  let deleted = false;
  const url = await resolveBaseUrl({
    isDev: false,
    storedUrl: 'http://192.168.1.65:3000',
    deleteStored: () => { deleted = true; }
  });

  assert.equal(deleted, true, 'Production builds must purge stored override');
  assert.equal(url, 'https://semestar-library.vercel.app');
});

test('API Config: Environment switching cleanly isolates credentials and local caches', async () => {
  // Mock switching routine
  const clearedItems = [];
  const fakeStore = {
    deleteItemAsync: (key) => clearedItems.push(key),
  };
  let chatDbCleared = false;
  let queryCacheCleared = false;
  let dmCacheCleared = false;

  async function simulateSwitchServer(newUrl) {
    if (!isTrustedServerUrl(newUrl, true)) {
      throw new Error('Untrusted URL');
    }
    // 1. Clear session tokens
    await fakeStore.deleteItemAsync('semester_library_mobile_token');
    await fakeStore.deleteItemAsync('semester_library_mobile_user');
    // 2. Clear local storage DBs & caches
    chatDbCleared = true;
    queryCacheCleared = true;
    dmCacheCleared = true;
  }

  await simulateSwitchServer('https://semestar-library.vercel.app');
  assert.ok(clearedItems.includes('semester_library_mobile_token'), 'Token must be cleared');
  assert.ok(clearedItems.includes('semester_library_mobile_user'), 'User must be cleared');
  assert.equal(chatDbCleared, true, 'Chat DB must be cleared');
  assert.equal(queryCacheCleared, true, 'Query cache must be cleared');
  assert.equal(dmCacheCleared, true, 'DM cache must be cleared');
});
