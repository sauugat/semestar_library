/**
 * Semester Library — Teacher-Owned Google Drive Attendance Backup Sync Engine (Mobile & Cross-Platform)
 *
 * Pure TypeScript core engine with zero top-level React Native native module imports so it can be:
 * 1. Consumed by `mobile/services/attendance-drive-sync.ts` (wired to Expo WebBrowser, SecureStore, and apiFetch)
 * 2. Imported directly in Node.js automated test suites without triggering React Native Flow syntax errors
 *
 * Implements:
 * - OAuth 2.0 Authorization Code with PKCE (S256) flow & native reverse-client-ID redirect URI builder
 * - Platform-specific Google OAuth Client ID resolution (iOS, Android, Web) and safe 'not_configured' state
 * - Narrow `https://www.googleapis.com/auth/drive.file` scope verification
 * - In-memory short-lived access token management + encrypted SecureStore refresh token adapter
 * - Strict outgoing payload & error-message secret scrubbing (zero token leakage to backend or logs)
 * - Idempotent Google Drive folder hierarchy provisioning (`Semester Library Attendance Backups/` + 3 subfolders)
 * - Durable client-side artifact sync worker for `snapshot`, `daily_workbook`, and `annual_workbook`
 * - Lost-completion recovery via Drive `appProperties` and content SHA-256 verification
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const DEFAULT_ROOT_FOLDER_NAME = 'Semester Library Attendance Backups';
export const SECURE_STORE_REFRESH_TOKEN_KEY = 'semester_library_teacher_drive_refresh_token_v1';

export const SUBFOLDER_DEFINITIONS = {
  daily: { key: 'dailyFolderId', name: 'Daily Attendance', role: 'daily_folder' },
  full: { key: 'fullFolderId', name: 'Full Attendance', role: 'full_folder' },
  snapshots: { key: 'snapshotsFolderId', name: 'Immutable Snapshots', role: 'snapshots_folder' },
} as const;

export type BackupArtifactType = 'snapshot' | 'daily_workbook' | 'annual_workbook';

export interface DriveOAuthConfigStatus {
  platform: 'ios' | 'android' | 'web';
  configured: boolean;
  status: 'configured' | 'not_configured';
  webConfigured: boolean;
  iosConfigured: boolean;
  androidConfigured: boolean;
  activeClientId: string | null;
  redirectUri: string | null;
  webClientId: string | null;
  iosClientId: string | null;
  androidClientId: string | null;
  scope: string;
}

export interface DriveFoldersMetadata {
  rootFolderId: string;
  rootFolderName: string;
  dailyFolderId: string;
  fullFolderId: string;
  snapshotsFolderId: string;
}

export interface SecureTokenStoreAdapter {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

export interface MobileDriveSyncClientOptions {
  platform?: 'ios' | 'android' | 'web';
  iosClientId?: string | null;
  androidClientId?: string | null;
  webClientId?: string | null;
  extraConfig?: Record<string, any> | null;
  appScheme?: string;
  clientIdTag?: string;
  now?: () => number;
  driveFetch?: typeof fetch;
  backendFetch?: (endpoint: string, options?: RequestInit) => Promise<Response>;
  openAuthSessionAsync?: (authUrl: string, redirectUri: string) => Promise<{ type: string; url?: string }>;
  secureStore?: SecureTokenStoreAdapter;
}

const FORBIDDEN_SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'oauthtoken',
  'oauth_token',
  'authtoken',
  'auth_token',
  'bearertoken',
  'bearer_token',
  'authorizationcode',
  'authorization_code',
  'authcode',
  'auth_code',
  'code',
  'clientsecret',
  'client_secret',
  'secret',
  'privatekey',
  'private_key',
  'password',
  'passwordhash',
  'password_hash',
  'apikey',
  'api_key',
  'credentials',
]);

const FORBIDDEN_TOKEN_VALUE_PATTERNS = [
  /^ya29\.[A-Za-z0-9._-]{10,}/,
  /^1\/\/[A-Za-z0-9._-]{10,}/,
  /^GOCSPX-[A-Za-z0-9._-]{8,}/,
  /^Bearer\s+[A-Za-z0-9._-]{10,}/i,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
];

/**
 * Scrubs OAuth access tokens, refresh tokens, client secrets, authorization codes, and claim tokens
 * from any error or diagnostic message before throwing or reporting.
 */
export function sanitizeClientErrorMessage(rawMessage: unknown): string {
  if (rawMessage === null || rawMessage === undefined) return 'Google Drive operation failed.';
  const cleaned = String(rawMessage)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[REDACTED_GOOGLE_TOKEN]')
    .replace(/1\/\/[A-Za-z0-9._-]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/GOCSPX-[A-Za-z0-9._-]+/g, '[REDACTED_CLIENT_SECRET]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED_JWT]')
    .replace(/([?&](?:access_token|refresh_token|id_token|code|client_secret|claim_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|id_token|client_secret|claim_token|claimtoken|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[REDACTED_TOKEN_HEX]')
    .replace(/[\u0000-\u001F]+/g, ' ')
    .trim();
  return (cleaned || 'Google Drive operation failed.').slice(0, 240);
}

export class DriveSyncError extends Error {
  code: string;
  status?: number;
  reconnectRequired?: boolean;
  data?: any;

  constructor(
    code: string,
    rawMessage: unknown,
    extra: { status?: number; reconnectRequired?: boolean; data?: any } = {}
  ) {
    super(sanitizeClientErrorMessage(rawMessage));
    this.name = 'DriveSyncError';
    this.code = code || 'DRIVE_CLIENT_ERROR';
    this.status = extra.status;
    this.reconnectRequired = extra.reconnectRequired;
    this.data = extra.data;
  }
}

/**
 * Client-side outgoing payload guard: ensures no OAuth token, refresh token, authorization code,
 * or client secret is ever included in a request body sent to the Semester Library backend.
 */
export function assertNoSecretsInBackendPayload(payload: unknown, contextLabel = 'backend request'): void {
  if (!payload || typeof payload !== 'object') return;

  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const [rawKey, val] of Object.entries(node)) {
      const normKey = String(rawKey).trim().toLowerCase();
      if (FORBIDDEN_SECRET_KEYS.has(normKey)) {
        throw new DriveSyncError(
          'SENSITIVE_TOKEN_FORBIDDEN',
          `Blocked attempt to send forbidden credential field "${rawKey}" in ${contextLabel}.`
        );
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        for (const pattern of FORBIDDEN_TOKEN_VALUE_PATTERNS) {
          if (pattern.test(trimmed)) {
            throw new DriveSyncError(
              'SENSITIVE_TOKEN_FORBIDDEN',
              `Blocked attempt to send credential pattern in "${rawKey}" of ${contextLabel}.`
            );
          }
        }
      } else if (val && typeof val === 'object') {
        visit(val);
      }
    }
  };

  visit(payload);
}

/**
 * Deterministically serializes a JSON value with lexicographically sorted object keys,
 * explicit null handling for undefined object properties, and zero whitespace.
 */
export function serializeCanonicalJson(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCanonicalJson(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((k) => {
      const v = value[k] === undefined ? null : value[k];
      return `${JSON.stringify(k)}:${serializeCanonicalJson(v)}`;
    });
    return `{${pairs.join(',')}}`;
  }
  return 'null';
}

export function utf8ToBytes(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(str));
  }
  const escaped = unescape(encodeURIComponent(String(str)));
  const out = new Uint8Array(escaped.length);
  for (let i = 0; i < escaped.length; i++) {
    out[i] = escaped.charCodeAt(i);
  }
  return out;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  let i = 0;
  while (i < len) {
    const b1 = bytes[i++] ?? 0;
    const hasB2 = i < len;
    const b2 = hasB2 ? (bytes[i++] ?? 0) : 0;
    const hasB3 = i < len;
    const b3 = hasB3 ? (bytes[i++] ?? 0) : 0;

    const triplet = (b1 << 16) | (b2 << 8) | b3;
    result += BASE64_CHARS[(triplet >> 18) & 0x3f];
    result += BASE64_CHARS[(triplet >> 12) & 0x3f];
    result += hasB2 ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    result += hasB3 ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return result;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const padLen = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLen = Math.floor((clean.length * 3) / 4) - padLen;
  const out = new Uint8Array(Math.max(0, byteLen));

  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_CHARS.indexOf(clean[i] || 'A');
    const c2 = BASE64_CHARS.indexOf(clean[i + 1] || 'A');
    const c3 = clean[i + 2] === '=' ? 0 : BASE64_CHARS.indexOf(clean[i + 2] || 'A');
    const c4 = clean[i + 3] === '=' ? 0 : BASE64_CHARS.indexOf(clean[i + 3] || 'A');

    const triplet = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    if (outIdx < out.length) out[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < out.length) out[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < out.length) out[outIdx++] = triplet & 0xff;
  }
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Pure JavaScript SHA-256 implementation (FIPS 180-4).
 * Ensures S256 PKCE code_challenge and canonical snapshot/workbook SHA-256 verification
 * work deterministically on Hermes (iOS/Android) and Node.js without native crypto add-ons.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256BytesSync(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const msgLen = data.length;
  const bitLenHi = Math.floor((msgLen * 8) / 0x100000000);
  const bitLenLo = (msgLen * 8) >>> 0;

  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const v15 = w[i - 15]!;
      const s0 = ((v15 >>> 7) | (v15 << 25)) ^ ((v15 >>> 18) | (v15 << 14)) ^ (v15 >>> 3);
      const v2 = w[i - 2]!;
      const s1 = ((v2 >>> 17) | (v2 << 15)) ^ ((v2 >>> 19) | (v2 << 13)) ^ (v2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export async function computeSha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : utf8ToBytes(String(input));
  const digest = sha256BytesSync(bytes);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSecureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Generates an RFC 7636 PKCE S256 code_verifier, code_challenge, and CSRF state parameter.
 */
export async function generatePkceChallengePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
}> {
  const verifierBytes = generateSecureRandomBytes(32);
  const codeVerifier = bytesToBase64Url(verifierBytes);
  const challengeDigest = sha256BytesSync(utf8ToBytes(codeVerifier));
  const codeChallenge = bytesToBase64Url(challengeDigest);
  const state = bytesToBase64Url(generateSecureRandomBytes(16));

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
    state,
  };
}

/**
 * Computes the Google OAuth native redirect URI for iOS/Android Client IDs.
 * Google native iOS/Android OAuth clients require the reverse client ID scheme:
 *   `<prefix>.apps.googleusercontent.com` -> `com.googleusercontent.apps.<prefix>:/oauthredirect`
 */
export function buildNativeGoogleRedirectUri(clientId: string | null, appScheme = 'semesterlibrary'): string {
  const clean = String(clientId || '').trim();
  const suffix = '.apps.googleusercontent.com';
  if (clean.toLowerCase().endsWith(suffix)) {
    const prefix = clean.slice(0, clean.length - suffix.length);
    if (prefix) {
      return `com.googleusercontent.apps.${prefix}:/oauthredirect`;
    }
  }
  return `${appScheme}://oauthredirect`;
}

function escapeDriveQueryValue(val: string): string {
  return String(val || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function buildMultipartRelatedBody(
  metadata: Record<string, any>,
  contentBytes: Uint8Array,
  contentMimeType: string
): { contentType: string; body: string } {
  const boundary = '-------SemesterLibraryMobileDriveSyncBoundary7MA4YWxkTrZu0gW';
  const metaJson = JSON.stringify(metadata || {});
  const isBinary = contentMimeType !== 'application/json' && !String(contentMimeType).startsWith('text/');

  let contentPartBody: string;
  let transferEncodingHeader = '';
  if (isBinary) {
    transferEncodingHeader = 'Content-Transfer-Encoding: base64\r\n';
    contentPartBody = bytesToBase64(contentBytes);
  } else {
    contentPartBody =
      typeof TextDecoder !== 'undefined'
        ? new TextDecoder('utf-8').decode(contentBytes)
        : String.fromCharCode(...Array.from(contentBytes));
  }

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metaJson}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentMimeType}\r\n` +
    transferEncodingHeader +
    `\r\n` +
    `${contentPartBody}\r\n` +
    `--${boundary}--`;

  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body,
  };
}

const noopSecureStore: SecureTokenStoreAdapter = {
  async getItemAsync() {
    return null;
  },
  async setItemAsync() {},
  async deleteItemAsync() {},
};

/**
 * Creates a reusable Mobile/Cross-Platform Attendance Google Drive Sync client.
 */
export function createMobileAttendanceDriveSyncCore(options: MobileDriveSyncClientOptions = {}) {
  const currentPlatform: 'ios' | 'android' | 'web' = options.platform || 'ios';
  const rawDriveFetch: typeof fetch = options.driveFetch || fetch;
  const rawBackendFetch =
    options.backendFetch ||
    ((endpoint: string, init?: RequestInit) => fetch(endpoint, init));
  const openAuthSession =
    options.openAuthSessionAsync ||
    (async () => ({ type: 'cancel' }));
  const secureStore = options.secureStore || noopSecureStore;
  const nowFn = options.now || (() => Date.now());
  const appScheme = options.appScheme || 'semesterlibrary';
  const clientIdTag =
    options.clientIdTag ||
    `mobile_${currentPlatform}_sync_${Math.random().toString(36).slice(2, 10)}`;

  // Short-lived access token kept strictly in memory (never AsyncStorage or localStorage)
  let inMemoryToken: {
    accessToken: string;
    expiresAtMs: number;
    scope: string;
  } | null = null;

  let cachedOAuthConfig: DriveOAuthConfigStatus | null = null;
  let cachedConnection: any = null;
  let activeSyncPromise: Promise<any> | null = null;
  let activeProvisionPromise: Promise<any> | null = null;

  function resolveOAuthConfig(serverOAuth: any = null): DriveOAuthConfigStatus {
    const extra = options.extraConfig || {};
    const envObj = (typeof process !== 'undefined' && process.env) ? process.env : ({} as Record<string, string | undefined>);

    const webClientId = String(
      options.webClientId ||
        envObj.EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID ||
        envObj.GOOGLE_DRIVE_WEB_CLIENT_ID ||
        extra.googleDriveWebClientId ||
        serverOAuth?.webClientId ||
        ''
    ).trim();

    const iosClientId = String(
      options.iosClientId ||
        envObj.EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID ||
        envObj.GOOGLE_DRIVE_IOS_CLIENT_ID ||
        extra.googleDriveIosClientId ||
        serverOAuth?.iosClientId ||
        ''
    ).trim();

    const androidClientId = String(
      options.androidClientId ||
        envObj.EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID ||
        envObj.GOOGLE_DRIVE_ANDROID_CLIENT_ID ||
        extra.googleDriveAndroidClientId ||
        serverOAuth?.androidClientId ||
        ''
    ).trim();

    const webConfigured = Boolean(webClientId || serverOAuth?.webConfigured);
    const iosConfigured = Boolean(iosClientId || serverOAuth?.iosConfigured);
    const androidConfigured = Boolean(androidClientId || serverOAuth?.androidConfigured);

    let activeClientId: string | null = null;
    if (currentPlatform === 'ios') {
      activeClientId = iosClientId || null;
    } else if (currentPlatform === 'android') {
      activeClientId = androidClientId || null;
    } else {
      activeClientId = webClientId || null;
    }

    const configured = Boolean(activeClientId);
    const redirectUri = activeClientId
      ? buildNativeGoogleRedirectUri(activeClientId, appScheme)
      : null;

    return {
      platform: currentPlatform,
      configured,
      status: configured ? 'configured' : 'not_configured',
      webConfigured,
      iosConfigured,
      androidConfigured,
      activeClientId,
      redirectUri,
      webClientId: webClientId || null,
      iosClientId: iosClientId || null,
      androidClientId: androidClientId || null,
      scope: DRIVE_FILE_SCOPE,
    };
  }

  async function callBackendJson<T = any>(path: string, fetchOptions: RequestInit = {}): Promise<T> {
    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((fetchOptions.headers as Record<string, string>) || {}),
    };

    if (headers.Authorization || headers.authorization) {
      const authVal = String(headers.Authorization || headers.authorization);
      if (/ya29\./.test(authVal) || (inMemoryToken && authVal.includes(inMemoryToken.accessToken))) {
        throw new DriveSyncError(
          'SENSITIVE_TOKEN_FORBIDDEN',
          'Blocked attempt to send Google OAuth access token to Semester Library backend.'
        );
      }
    }

    let bodyStr: string | undefined;
    if (fetchOptions.body !== undefined && fetchOptions.body !== null) {
      const parsedBody =
        typeof fetchOptions.body === 'string' ? JSON.parse(fetchOptions.body) : fetchOptions.body;
      assertNoSecretsInBackendPayload(parsedBody, `${method} ${path}`);
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(parsedBody);
    }

    const res = await rawBackendFetch(path, {
      ...fetchOptions,
      method,
      headers,
      body: bodyStr,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new DriveSyncError(
        data.code || data.error || `HTTP_${res.status}`,
        data.message || `Backend request ${method} ${path} failed (${res.status}).`,
        { status: res.status, data }
      );
    }
    return data as T;
  }

  async function callBackendWorkbookJson(path: string): Promise<any> {
    const sep = path.includes('?') ? '&' : '?';
    return await callBackendJson(`${path}${sep}format=json`, { method: 'GET' });
  }

  function hasValidAccessToken(): boolean {
    if (!inMemoryToken || !inMemoryToken.accessToken) return false;
    return inMemoryToken.expiresAtMs - 30_000 > nowFn();
  }

  function setAccessTokenForSession({
    accessToken,
    expiresInSeconds = 3600,
    scope = DRIVE_FILE_SCOPE,
  }: {
    accessToken: string;
    expiresInSeconds?: number;
    scope?: string;
  }) {
    const cleanToken = String(accessToken || '').trim();
    if (!cleanToken) {
      throw new DriveSyncError('OAUTH_TOKEN_MISSING', 'Google OAuth did not return an access token.');
    }
    const ttlMs = Math.max(60, Number(expiresInSeconds) || 3600) * 1000;
    inMemoryToken = {
      accessToken: cleanToken,
      expiresAtMs: nowFn() + ttlMs,
      scope: String(scope || DRIVE_FILE_SCOPE),
    };
    return {
      authorized: true,
      expiresAt: new Date(inMemoryToken.expiresAtMs).toISOString(),
      scope: inMemoryToken.scope,
    };
  }

  async function clearTokens({ deleteRefreshToken = false } = {}): Promise<void> {
    inMemoryToken = null;
    if (deleteRefreshToken) {
      await secureStore.deleteItemAsync(SECURE_STORE_REFRESH_TOKEN_KEY).catch(() => {});
    }
  }

  async function getStatus() {
    const statusData = await callBackendJson('/api/attendance/backup/status', { method: 'GET' });
    cachedOAuthConfig = resolveOAuthConfig(statusData?.oauth);
    cachedConnection = statusData?.connection || null;
    return {
      ...statusData,
      oauth: cachedOAuthConfig,
      hasActiveMemoryToken: hasValidAccessToken(),
    };
  }

  async function refreshAccessTokenFromSecureStore(): Promise<boolean> {
    const cfg = resolveOAuthConfig(cachedOAuthConfig);
    if (!cfg.configured || !cfg.activeClientId) return false;

    let refreshToken: string | null = null;
    try {
      refreshToken = await secureStore.getItemAsync(SECURE_STORE_REFRESH_TOKEN_KEY);
    } catch {
      return false;
    }

    if (!refreshToken || !refreshToken.trim()) return false;

    const formBody = new URLSearchParams({
      client_id: cfg.activeClientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken.trim(),
    }).toString();

    try {
      const res = await rawDriveFetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody,
      });

      const tokenData = await res.json().catch(() => ({}));
      if (!res.ok || !tokenData.access_token) {
        if (res.status === 400 || res.status === 401) {
          await secureStore.deleteItemAsync(SECURE_STORE_REFRESH_TOKEN_KEY).catch(() => {});
        }
        return false;
      }

      setAccessTokenForSession({
        accessToken: tokenData.access_token,
        expiresInSeconds: Number(tokenData.expires_in) || 3600,
        scope: tokenData.scope || DRIVE_FILE_SCOPE,
      });

      if (tokenData.refresh_token && typeof tokenData.refresh_token === 'string') {
        await secureStore.setItemAsync(SECURE_STORE_REFRESH_TOKEN_KEY, tokenData.refresh_token.trim()).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  async function requestAuthorization({ prompt = 'consent' }: { prompt?: string } = {}) {
    let cfg = resolveOAuthConfig(cachedOAuthConfig);
    if (!cfg.activeClientId) {
      try {
        const statusData = await getStatus();
        cfg = statusData.oauth;
      } catch {}
    }

    if (!cfg.configured || !cfg.activeClientId || !cfg.redirectUri) {
      return {
        authorized: false,
        notConfigured: true,
        status: 'not_configured' as const,
        code: 'OAUTH_NOT_CONFIGURED',
        message: `Google Drive OAuth Client ID for ${currentPlatform} is not configured.`,
      };
    }

    if (hasValidAccessToken() && prompt !== 'consent') {
      return {
        authorized: true,
        notConfigured: false,
        status: 'authorized' as const,
        expiresAt: new Date(inMemoryToken!.expiresAtMs).toISOString(),
        scope: inMemoryToken!.scope,
      };
    }

    const pkce = await generatePkceChallengePair();
    const authParams = new URLSearchParams({
      client_id: cfg.activeClientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: DRIVE_FILE_SCOPE,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
      state: pkce.state,
      access_type: 'offline',
      ...(prompt ? { prompt } : {}),
    });

    const authUrl = `${GOOGLE_OAUTH_AUTH_URL}?${authParams.toString()}`;
    const sessionResult = await openAuthSession(authUrl, cfg.redirectUri);

    if (!sessionResult || sessionResult.type !== 'success' || !sessionResult.url) {
      throw new DriveSyncError(
        'OAUTH_CANCELLED',
        'Google Drive authorization was cancelled or dismissed by the user.'
      );
    }

    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(sessionResult.url);
    } catch {
      throw new DriveSyncError('OAUTH_REDIRECT_INVALID', 'Received invalid redirect URL from Google OAuth.');
    }

    const errorParam = parsedRedirect.searchParams.get('error');
    if (errorParam) {
      const errDesc = parsedRedirect.searchParams.get('error_description') || errorParam;
      if (errorParam === 'access_denied' || errorParam.includes('cancel')) {
        throw new DriveSyncError('OAUTH_CANCELLED', errDesc);
      }
      throw new DriveSyncError('OAUTH_AUTHORIZATION_ERROR', errDesc);
    }

    const returnedState = parsedRedirect.searchParams.get('state');
    if (returnedState !== pkce.state) {
      throw new DriveSyncError('OAUTH_STATE_MISMATCH', 'OAuth state parameter mismatch.');
    }

    const authCode = parsedRedirect.searchParams.get('code');
    if (!authCode || !authCode.trim()) {
      throw new DriveSyncError('OAUTH_CODE_MISSING', 'Authorization code missing from OAuth redirect.');
    }

    const tokenParams = new URLSearchParams({
      client_id: cfg.activeClientId,
      code: authCode.trim(),
      code_verifier: pkce.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    });

    const tokenRes = await rawDriveFetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
    });

    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new DriveSyncError(
        'OAUTH_TOKEN_EXCHANGE_FAILED',
        tokenJson.error_description || tokenJson.error || 'Failed to exchange Google OAuth code for token.'
      );
    }

    const grantedScope = String(tokenJson.scope || '');
    if (grantedScope && !grantedScope.includes('drive.file')) {
      throw new DriveSyncError(
        'OAUTH_SCOPE_MISSING',
        'Required Google Drive file permission (drive.file) was not granted.'
      );
    }

    const sessionInfo = setAccessTokenForSession({
      accessToken: tokenJson.access_token,
      expiresInSeconds: Number(tokenJson.expires_in) || 3600,
      scope: grantedScope || DRIVE_FILE_SCOPE,
    });

    if (tokenJson.refresh_token && typeof tokenJson.refresh_token === 'string') {
      await secureStore
        .setItemAsync(SECURE_STORE_REFRESH_TOKEN_KEY, tokenJson.refresh_token.trim())
        .catch(() => {});
    }

    return {
      notConfigured: false,
      status: 'authorized' as const,
      ...sessionInfo,
    };
  }

  async function ensureValidAccessTokenOrRefresh(): Promise<boolean> {
    if (hasValidAccessToken()) return true;
    return await refreshAccessTokenFromSecureStore();
  }

  async function driveApiRequest(urlOrPath: string, fetchOptions: RequestInit = {}): Promise<any> {
    const hasToken = await ensureValidAccessTokenOrRefresh();
    if (!hasToken || !inMemoryToken) {
      await clearTokens({ deleteRefreshToken: false });
      throw new DriveSyncError(
        'DRIVE_AUTH_EXPIRED',
        'Google Drive access token is missing or expired. Reconnection is required.',
        { reconnectRequired: true, status: 401 }
      );
    }

    const url = urlOrPath.startsWith('http') ? urlOrPath : `${DRIVE_API_BASE}${urlOrPath}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((fetchOptions.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${inMemoryToken.accessToken}`,
    };

    let res: Response;
    try {
      res = await rawDriveFetch(url, {
        ...fetchOptions,
        headers,
      });
    } catch (netErr: any) {
      throw new DriveSyncError(
        'DRIVE_NETWORK_ERROR',
        netErr?.message || 'Network error while communicating with Google Drive.',
        { reconnectRequired: false }
      );
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const errReason = data?.error?.errors?.[0]?.reason || '';
      const errMessage =
        data?.error?.message || `Google Drive authorization error (${res.status})`;
      const isQuotaOrRateLimit =
        res.status === 403 &&
        /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|sharingRateLimitExceeded/i.test(errReason);

      if (!isQuotaOrRateLimit) {
        await clearTokens({ deleteRefreshToken: true });
        throw new DriveSyncError('DRIVE_AUTH_EXPIRED', errMessage, {
          reconnectRequired: true,
          status: res.status,
        });
      }

      throw new DriveSyncError('DRIVE_RATE_LIMIT', errMessage, {
        reconnectRequired: false,
        status: res.status,
      });
    }

    if (!res.ok) {
      const errMessage =
        data?.error?.message || `Google Drive request failed with HTTP ${res.status}.`;
      throw new DriveSyncError(`DRIVE_HTTP_${res.status}`, errMessage, {
        reconnectRequired: false,
        status: res.status,
      });
    }

    return data;
  }

  async function verifyFolderAccessible(folderId?: string | null): Promise<any | null> {
    if (!folderId || typeof folderId !== 'string' || !folderId.trim()) return null;
    try {
      const meta = await driveApiRequest(
        `/files/${encodeURIComponent(folderId.trim())}?fields=id,name,mimeType,trashed,appProperties`,
        { method: 'GET' }
      );
      if (!meta || meta.trashed === true || meta.mimeType !== FOLDER_MIME_TYPE) {
        return null;
      }
      return meta;
    } catch (err: any) {
      if (err?.reconnectRequired) throw err;
      if (err?.status === 404) return null;
      throw err;
    }
  }

  async function searchExistingFolder({
    name,
    parentId = null,
    folderRole = null,
  }: {
    name: string;
    parentId?: string | null;
    folderRole?: string | null;
  }): Promise<any | null> {
    const clauses = [
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      `trashed = false`,
      `name = '${escapeDriveQueryValue(name)}'`,
    ];
    if (parentId) {
      clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
    }
    if (folderRole) {
      clauses.push(`appProperties has { key='slFolderRole' and value='${escapeDriveQueryValue(folderRole)}' }`);
    }

    const q = clauses.join(' and ');
    const data = await driveApiRequest(
      `/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,appProperties)&orderBy=createdTime%20asc&pageSize=10`,
      { method: 'GET' }
    );
    if (Array.isArray(data?.files) && data.files.length > 0) {
      return data.files[0];
    }

    if (folderRole) {
      const fallbackClauses = [
        `mimeType = '${FOLDER_MIME_TYPE}'`,
        `trashed = false`,
        `name = '${escapeDriveQueryValue(name)}'`,
      ];
      if (parentId) {
        fallbackClauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
      }
      const fallbackQ = fallbackClauses.join(' and ');
      const fallbackData = await driveApiRequest(
        `/files?q=${encodeURIComponent(fallbackQ)}&fields=files(id,name,createdTime,appProperties)&orderBy=createdTime%20asc&pageSize=10`,
        { method: 'GET' }
      );
      if (Array.isArray(fallbackData?.files) && fallbackData.files.length > 0) {
        return fallbackData.files[0];
      }
    }

    return null;
  }

  async function createDriveFolder({
    name,
    parentId = null,
    folderRole = null,
  }: {
    name: string;
    parentId?: string | null;
    folderRole?: string | null;
  }): Promise<any> {
    const metadata: Record<string, any> = {
      name,
      mimeType: FOLDER_MIME_TYPE,
      appProperties: {
        slApp: 'semester_library',
        ...(folderRole ? { slFolderRole: folderRole } : {}),
      },
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    return await driveApiRequest('/files?fields=id,name,mimeType,appProperties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  async function resolveOrCreateFolder({
    savedFolderId,
    name,
    parentId = null,
    folderRole = null,
  }: {
    savedFolderId?: string | null;
    name: string;
    parentId?: string | null;
    folderRole?: string | null;
  }) {
    if (savedFolderId) {
      const verified = await verifyFolderAccessible(savedFolderId);
      if (verified) {
        return { id: verified.id as string, name: (verified.name || name) as string, reused: true, source: 'saved_id' as const };
      }
    }

    const found = await searchExistingFolder({ name, parentId, folderRole });
    if (found?.id) {
      return { id: found.id as string, name: (found.name || name) as string, reused: true, source: 'search' as const };
    }

    const created = await createDriveFolder({ name, parentId, folderRole });
    return { id: created.id as string, name: (created.name || name) as string, reused: false, source: 'created' as const };
  }

  async function ensureFolderHierarchy({ googleEmail = null }: { googleEmail?: string | null } = {}) {
    if (activeProvisionPromise) {
      return await activeProvisionPromise;
    }

    activeProvisionPromise = (async () => {
      const statusData = await getStatus();
      const savedConn = statusData.connection || {};

      let resolvedEmail: string | null = googleEmail || savedConn.googleEmail || null;
      if (!resolvedEmail) {
        try {
          const about = await driveApiRequest('/about?fields=user(emailAddress)', { method: 'GET' });
          if (about?.user?.emailAddress) {
            resolvedEmail = String(about.user.emailAddress).trim().toLowerCase();
          }
        } catch (err: any) {
          if (err?.reconnectRequired) throw err;
        }
      }

      const rootFolderName = savedConn.rootFolderName || DEFAULT_ROOT_FOLDER_NAME;
      const rootFolder = await resolveOrCreateFolder({
        savedFolderId: savedConn.rootFolderId,
        name: rootFolderName,
        parentId: null,
        folderRole: 'root_folder',
      });

      const dailyFolder = await resolveOrCreateFolder({
        savedFolderId: savedConn.dailyFolderId,
        name: SUBFOLDER_DEFINITIONS.daily.name,
        parentId: rootFolder.id,
        folderRole: SUBFOLDER_DEFINITIONS.daily.role,
      });

      const fullFolder = await resolveOrCreateFolder({
        savedFolderId: savedConn.fullFolderId,
        name: SUBFOLDER_DEFINITIONS.full.name,
        parentId: rootFolder.id,
        folderRole: SUBFOLDER_DEFINITIONS.full.role,
      });

      const snapshotsFolder = await resolveOrCreateFolder({
        savedFolderId: savedConn.snapshotsFolderId,
        name: SUBFOLDER_DEFINITIONS.snapshots.name,
        parentId: rootFolder.id,
        folderRole: SUBFOLDER_DEFINITIONS.snapshots.role,
      });

      const connectionPayload: Record<string, any> = {
        connectionStatus: 'connected',
        rootFolderId: rootFolder.id,
        rootFolderName,
        dailyFolderId: dailyFolder.id,
        fullFolderId: fullFolder.id,
        snapshotsFolderId: snapshotsFolder.id,
        ...(resolvedEmail ? { googleEmail: resolvedEmail } : {}),
      };

      const savedResult = await callBackendJson('/api/attendance/backup/connection', {
        method: 'PUT',
        body: JSON.stringify(connectionPayload),
      });

      cachedConnection = savedResult.connection || null;
      return {
        connected: true,
        folders: {
          rootFolderId: rootFolder.id,
          rootFolderName,
          dailyFolderId: dailyFolder.id,
          fullFolderId: fullFolder.id,
          snapshotsFolderId: snapshotsFolder.id,
        } as DriveFoldersMetadata,
        resolution: {
          root: rootFolder.source,
          daily: dailyFolder.source,
          full: fullFolder.source,
          snapshots: snapshotsFolder.source,
        },
        connection: cachedConnection,
      };
    })();

    try {
      return await activeProvisionPromise;
    } finally {
      activeProvisionPromise = null;
    }
  }

  async function connectGoogleDrive({
    prompt = 'consent',
    googleEmail = null,
  }: {
    prompt?: string;
    googleEmail?: string | null;
  } = {}) {
    const authResult = await requestAuthorization({ prompt });
    if (authResult.notConfigured) {
      return authResult;
    }
    const provisioned = await ensureFolderHierarchy({ googleEmail });
    return {
      authorized: true,
      notConfigured: false,
      status: 'connected' as const,
      ...provisioned,
    };
  }

  async function disconnectGoogleDrive({ clearFolders = false }: { clearFolders?: boolean } = {}) {
    const tokenToRevoke = inMemoryToken?.accessToken || null;
    await clearTokens({ deleteRefreshToken: true });

    if (tokenToRevoke) {
      try {
        await rawDriveFetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch {}
    }

    const disconnectResult = await callBackendJson('/api/attendance/backup/disconnect', {
      method: 'POST',
      body: JSON.stringify({ clearFolders: Boolean(clearFolders) }),
    });
    cachedConnection = disconnectResult.connection || null;
    return disconnectResult;
  }

  async function findExistingArtifactFile({
    folderId,
    savedDriveFileId = null,
    artifactType,
    targetScopeKey,
    driveFileName,
  }: {
    folderId: string;
    savedDriveFileId?: string | null;
    artifactType: BackupArtifactType;
    targetScopeKey: string;
    driveFileName?: string | null;
  }): Promise<any | null> {
    if (savedDriveFileId) {
      try {
        const meta = await driveApiRequest(
          `/files/${encodeURIComponent(savedDriveFileId)}?fields=id,name,mimeType,trashed,sha256Checksum,appProperties`,
          { method: 'GET' }
        );
        if (meta && !meta.trashed) {
          return meta;
        }
      } catch (err: any) {
        if (err?.reconnectRequired) throw err;
        if (!err || err.status !== 404) throw err;
      }
    }

    const propClauses = [
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      `trashed = false`,
      `appProperties has { key='slArtifactType' and value='${escapeDriveQueryValue(artifactType)}' }`,
      `appProperties has { key='slScopeKey' and value='${escapeDriveQueryValue(targetScopeKey)}' }`,
    ];
    const propQuery = propClauses.join(' and ');
    const propRes = await driveApiRequest(
      `/files?q=${encodeURIComponent(propQuery)}&fields=files(id,name,mimeType,sha256Checksum,appProperties,createdTime)&orderBy=createdTime%20asc&pageSize=5`,
      { method: 'GET' }
    );
    if (Array.isArray(propRes?.files) && propRes.files.length > 0) {
      return propRes.files[0];
    }

    if (driveFileName) {
      const nameClauses = [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        `trashed = false`,
        `name = '${escapeDriveQueryValue(driveFileName)}'`,
      ];
      const nameQuery = nameClauses.join(' and ');
      const nameRes = await driveApiRequest(
        `/files?q=${encodeURIComponent(nameQuery)}&fields=files(id,name,mimeType,sha256Checksum,appProperties,createdTime)&orderBy=createdTime%20asc&pageSize=5`,
        { method: 'GET' }
      );
      if (Array.isArray(nameRes?.files) && nameRes.files.length > 0) {
        return nameRes.files[0];
      }
    }

    return null;
  }

  async function uploadOrReconcileArtifactToDrive({
    artifactMeta,
    claimedItem,
    runBundle,
    folders,
  }: {
    artifactMeta: any;
    claimedItem: any;
    runBundle: any;
    folders: DriveFoldersMetadata;
  }) {
    const artifactType = claimedItem.artifactType as BackupArtifactType;
    const revisionNo = Number(runBundle.revisionNo);
    const snapshotSha256 = String(runBundle.snapshotSha256).toLowerCase();
    const sessionId = String(runBundle.sessionId);
    const targetScopeKey: string =
      artifactMeta?.targetScopeKey ||
      (artifactType === 'snapshot'
        ? `session:${sessionId}:v${revisionNo}`
        : artifactType === 'daily_workbook'
        ? `daily:${runBundle.teacherId}:${runBundle.workbooks.daily.date}`
        : `annual:${runBundle.teacherId}:${runBundle.workbooks.annual.year}`);

    let folderId: string;
    let driveFileName: string;
    let mimeType: string;
    let contentBytes: Uint8Array;
    let artifactSha256: string;

    if (artifactType === 'snapshot') {
      folderId = folders.snapshotsFolderId;
      driveFileName =
        claimedItem.driveFileName ||
        artifactMeta?.driveFileName ||
        runBundle.snapshot.filename;
      mimeType = 'application/json';

      const canonicalJsonStr = serializeCanonicalJson(runBundle.snapshot.payload);
      contentBytes = utf8ToBytes(canonicalJsonStr);
      const computedSha = await computeSha256Hex(contentBytes);
      if (computedSha !== snapshotSha256) {
        throw new DriveSyncError(
          'SNAPSHOT_INTEGRITY_MISMATCH',
          `Canonical snapshot SHA-256 mismatch: expected ${snapshotSha256}, computed ${computedSha}.`
        );
      }
      artifactSha256 = snapshotSha256;
    } else if (artifactType === 'daily_workbook') {
      folderId = folders.dailyFolderId;
      let wbBundle = runBundle.workbooks?.daily?.bundle;
      if (!wbBundle || !wbBundle.base64) {
        wbBundle = await callBackendWorkbookJson(runBundle.workbooks.daily.downloadPath);
      }
      driveFileName =
        claimedItem.driveFileName ||
        artifactMeta?.driveFileName ||
        wbBundle.filename;
      mimeType = wbBundle.mimeType || XLSX_MIME_TYPE;
      contentBytes = base64ToBytes(wbBundle.base64);
      const computedSha = await computeSha256Hex(contentBytes);
      if (wbBundle.sha256 && computedSha !== String(wbBundle.sha256).toLowerCase()) {
        throw new DriveSyncError(
          'WORKBOOK_INTEGRITY_MISMATCH',
          'Downloaded daily workbook SHA-256 did not match server header.'
        );
      }
      artifactSha256 = computedSha;
    } else if (artifactType === 'annual_workbook') {
      folderId = folders.fullFolderId;
      let wbBundle = runBundle.workbooks?.annual?.bundle;
      if (!wbBundle || !wbBundle.base64) {
        wbBundle = await callBackendWorkbookJson(runBundle.workbooks.annual.downloadPath);
      }
      driveFileName =
        claimedItem.driveFileName ||
        artifactMeta?.driveFileName ||
        wbBundle.filename;
      mimeType = wbBundle.mimeType || XLSX_MIME_TYPE;
      contentBytes = base64ToBytes(wbBundle.base64);
      const computedSha = await computeSha256Hex(contentBytes);
      if (wbBundle.sha256 && computedSha !== String(wbBundle.sha256).toLowerCase()) {
        throw new DriveSyncError(
          'WORKBOOK_INTEGRITY_MISMATCH',
          'Downloaded annual workbook SHA-256 did not match server header.'
        );
      }
      artifactSha256 = computedSha;
    } else {
      throw new DriveSyncError('INVALID_ARTIFACT_TYPE', `Unsupported artifactType "${artifactType}".`);
    }

    const appProperties = {
      slApp: 'semester_library',
      slArtifactType: artifactType,
      slScopeKey: targetScopeKey,
      slSessionId: sessionId,
      slRevisionNo: String(revisionNo),
      slSnapshotSha256: snapshotSha256,
      slArtifactSha256: artifactSha256,
    };

    const existingFile = await findExistingArtifactFile({
      folderId,
      savedDriveFileId: artifactMeta?.driveFileId || null,
      artifactType,
      targetScopeKey,
      driveFileName,
    });

    if (existingFile && existingFile.id) {
      const existingProps = existingFile.appProperties || {};
      const existingSha = String(
        existingProps.slArtifactSha256 || existingFile.sha256Checksum || ''
      ).toLowerCase();

      if (artifactType === 'snapshot') {
        if (existingSha && existingSha !== artifactSha256) {
          throw new DriveSyncError(
            'IMMUTABLE_SNAPSHOT_CONFLICT',
            `Existing snapshot file in Google Drive has a different SHA-256 (${existingSha.slice(0, 12)}...). Refusing to overwrite immutable snapshot.`
          );
        }
        return {
          driveFileId: existingFile.id as string,
          driveFileName: (existingFile.name || driveFileName) as string,
          artifactSha256,
          reusedExistingFile: true,
        };
      }

      if (
        existingProps.slSessionId === sessionId &&
        existingProps.slRevisionNo &&
        Number(existingProps.slRevisionNo) > revisionNo
      ) {
        throw new DriveSyncError(
          'STALE_REVISION_WORKBOOK',
          `Drive workbook already reflects newer revision v${existingProps.slRevisionNo} (current run is v${revisionNo}).`
        );
      }

      if (existingSha === artifactSha256) {
        return {
          driveFileId: existingFile.id as string,
          driveFileName: (existingFile.name || driveFileName) as string,
          artifactSha256,
          reusedExistingFile: true,
        };
      }

      const patchMultipart = buildMultipartRelatedBody(
        {
          name: driveFileName,
          appProperties,
        },
        contentBytes,
        mimeType
      );

      const updatedFile = await driveApiRequest(
        `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFile.id)}?uploadType=multipart&fields=id,name,sha256Checksum,appProperties`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': patchMultipart.contentType },
          body: patchMultipart.body,
        }
      );

      return {
        driveFileId: (updatedFile.id || existingFile.id) as string,
        driveFileName: (updatedFile.name || driveFileName) as string,
        artifactSha256,
        reusedExistingFile: false,
      };
    }

    const createMultipart = buildMultipartRelatedBody(
      {
        name: driveFileName,
        mimeType,
        parents: [folderId],
        appProperties,
      },
      contentBytes,
      mimeType
    );

    const createdFile = await driveApiRequest(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,sha256Checksum,appProperties`,
      {
        method: 'POST',
        headers: { 'Content-Type': createMultipart.contentType },
        body: createMultipart.body,
      }
    );

    if (!createdFile || !createdFile.id) {
      throw new DriveSyncError('DRIVE_UPLOAD_EMPTY_ID', 'Google Drive upload did not return a valid file ID.');
    }

    return {
      driveFileId: createdFile.id as string,
      driveFileName: (createdFile.name || driveFileName) as string,
      artifactSha256,
      reusedExistingFile: false,
    };
  }

  async function syncPendingWork({
    sessionId = null,
    forceRetry = false,
    maxRuns = 25,
    leaseDurationMs = 120_000,
  }: {
    sessionId?: string | null;
    forceRetry?: boolean;
    maxRuns?: number;
    leaseDurationMs?: number;
  } = {}) {
    if (activeSyncPromise) {
      return await activeSyncPromise;
    }

    activeSyncPromise = (async () => {
      const statusInfo = await getStatus();
      if (!statusInfo.oauth || !statusInfo.oauth.configured) {
        return {
          synced: false,
          status: 'not_configured' as const,
          notConfigured: true,
          processedRuns: 0,
          completedArtifacts: 0,
          failedArtifacts: 0,
          runs: [],
        };
      }

      const tokenReady = await ensureValidAccessTokenOrRefresh();
      if (!tokenReady) {
        return {
          synced: false,
          status: 'reconnect_required' as const,
          reconnectRequired: true,
          processedRuns: 0,
          completedArtifacts: 0,
          failedArtifacts: 0,
          runs: [],
        };
      }

      let folders: DriveFoldersMetadata;
      try {
        const folderRes = await ensureFolderHierarchy();
        folders = folderRes.folders;
      } catch (folderErr: any) {
        return {
          synced: false,
          status: folderErr?.reconnectRequired ? ('reconnect_required' as const) : ('failed' as const),
          reconnectRequired: Boolean(folderErr?.reconnectRequired),
          errorCode: folderErr?.code || 'FOLDER_PROVISION_FAILED',
          errorMessage: sanitizeClientErrorMessage(folderErr?.message),
          processedRuns: 0,
          completedArtifacts: 0,
          failedArtifacts: 0,
          runs: [],
        };
      }

      const pendingQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const pendingData = await callBackendJson(`/api/attendance/backup/pending${pendingQuery}`, {
        method: 'GET',
      });

      const candidateRuns = Array.isArray(pendingData?.runs) ? pendingData.runs.slice(0, maxRuns) : [];
      const runSummaries: any[] = [];
      let totalCompletedArtifacts = 0;
      let totalFailedArtifacts = 0;
      let haltedByAuthExpiry = false;

      for (const pendingRun of candidateRuns) {
        if (haltedByAuthExpiry) break;

        const claimableTypes = Array.isArray(pendingRun.claimableArtifactTypes)
          ? pendingRun.claimableArtifactTypes
          : [];
        if (claimableTypes.length === 0 && !forceRetry) {
          continue;
        }

        let claimRes: any;
        try {
          claimRes = await callBackendJson(
            `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/claim`,
            {
              method: 'POST',
              body: JSON.stringify({
                clientId: clientIdTag,
                leaseDurationMs,
                forceRetry: Boolean(forceRetry),
                revisionNo: pendingRun.revisionNo,
                snapshotSha256: pendingRun.snapshotSha256,
              }),
            }
          );
        } catch (claimErr: any) {
          runSummaries.push({
            runId: pendingRun.id,
            claimed: false,
            skippedReason: claimErr?.code || 'CLAIM_CONFLICT',
            message: sanitizeClientErrorMessage(claimErr?.message),
          });
          continue;
        }

        if (!claimRes.claimed || !Array.isArray(claimRes.claimedArtifacts) || claimRes.claimedArtifacts.length === 0) {
          runSummaries.push({
            runId: pendingRun.id,
            claimed: false,
            alreadyBackedUp: Boolean(claimRes.alreadyBackedUp),
          });
          continue;
        }

        let runBundle: any;
        try {
          runBundle = await callBackendJson(
            `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/artifacts?includePayloads=1`,
            { method: 'GET' }
          );
        } catch (bundleErr: any) {
          for (const claimedItem of claimRes.claimedArtifacts) {
            await callBackendJson(
              `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/fail`,
              {
                method: 'POST',
                body: JSON.stringify({
                  artifactType: claimedItem.artifactType,
                  claimToken: claimedItem.claimToken,
                  errorCode: bundleErr?.code || 'ARTIFACT_FETCH_FAILED',
                  errorMessage: sanitizeClientErrorMessage(bundleErr?.message),
                  reconnectRequired: false,
                }),
              }
            ).catch(() => {});
            totalFailedArtifacts += 1;
          }
          runSummaries.push({
            runId: pendingRun.id,
            claimed: true,
            status: 'failed',
            errorCode: bundleErr?.code || 'ARTIFACT_FETCH_FAILED',
          });
          continue;
        }

        const artifactMetaByType = new Map(
          (runBundle.artifacts || []).map((a: any) => [a.artifactType, a])
        );
        const perArtifactOutcomes: any[] = [];

        for (const claimedItem of claimRes.claimedArtifacts) {
          const artMeta = artifactMetaByType.get(claimedItem.artifactType) || null;

          if (claimedItem.leaseExpiresAt && new Date(claimedItem.leaseExpiresAt).getTime() <= nowFn()) {
            perArtifactOutcomes.push({
              artifactType: claimedItem.artifactType,
              status: 'lease_expired',
            });
            totalFailedArtifacts += 1;
            continue;
          }

          try {
            const uploaded = await uploadOrReconcileArtifactToDrive({
              artifactMeta: artMeta,
              claimedItem,
              runBundle,
              folders,
            });

            await callBackendJson(
              `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/complete`,
              {
                method: 'POST',
                body: JSON.stringify({
                  artifactType: claimedItem.artifactType,
                  claimToken: claimedItem.claimToken,
                  revisionNo: runBundle.revisionNo,
                  snapshotSha256: runBundle.snapshotSha256,
                  driveFileId: uploaded.driveFileId,
                  driveFileName: uploaded.driveFileName,
                  artifactSha256: uploaded.artifactSha256,
                }),
              }
            );

            totalCompletedArtifacts += 1;
            perArtifactOutcomes.push({
              artifactType: claimedItem.artifactType,
              status: 'backed_up',
              driveFileId: uploaded.driveFileId,
              reusedExistingFile: uploaded.reusedExistingFile,
            });
          } catch (artErr: any) {
            const isReconnectRequired = Boolean(artErr?.reconnectRequired);
            const errCode = artErr?.code || (isReconnectRequired ? 'DRIVE_AUTH_EXPIRED' : 'DRIVE_UPLOAD_FAILED');
            const errMsg = sanitizeClientErrorMessage(artErr?.message);

            if (
              errCode !== 'CLAIM_LEASE_EXPIRED' &&
              errCode !== 'STALE_OR_INVALID_CLAIM' &&
              errCode !== 'STALE_REVISION_WORKBOOK' &&
              errCode !== 'DRIVE_DISCONNECTED'
            ) {
              await callBackendJson(
                `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/fail`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    artifactType: claimedItem.artifactType,
                    claimToken: claimedItem.claimToken,
                    errorCode: errCode,
                    errorMessage: errMsg,
                    reconnectRequired: isReconnectRequired,
                  }),
                }
              ).catch(() => {});
            }

            totalFailedArtifacts += 1;
            perArtifactOutcomes.push({
              artifactType: claimedItem.artifactType,
              status: isReconnectRequired ? 'reconnect_required' : 'failed',
              errorCode: errCode,
              errorMessage: errMsg,
            });

            if (isReconnectRequired) {
              haltedByAuthExpiry = true;
              for (const sibling of claimRes.claimedArtifacts) {
                if (sibling.artifactType === claimedItem.artifactType) continue;
                const alreadyDone = perArtifactOutcomes.some((o) => o.artifactType === sibling.artifactType);
                if (!alreadyDone) {
                  await callBackendJson(
                    `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/fail`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        artifactType: sibling.artifactType,
                        claimToken: sibling.claimToken,
                        errorCode: 'DRIVE_AUTH_EXPIRED',
                        errorMessage: 'Google Drive authorization expired before upload could start.',
                        reconnectRequired: true,
                      }),
                    }
                  ).catch(() => {});
                }
              }
              break;
            }
          }
        }

        runSummaries.push({
          runId: pendingRun.id,
          sessionId: pendingRun.sessionId,
          revisionNo: pendingRun.revisionNo,
          claimed: true,
          artifacts: perArtifactOutcomes,
        });
      }

      return {
        synced: !haltedByAuthExpiry && totalFailedArtifacts === 0,
        status: haltedByAuthExpiry
          ? ('reconnect_required' as const)
          : totalFailedArtifacts > 0
          ? ('partial_or_failed' as const)
          : ('backed_up' as const),
        reconnectRequired: haltedByAuthExpiry,
        processedRuns: runSummaries.length,
        completedArtifacts: totalCompletedArtifacts,
        failedArtifacts: totalFailedArtifacts,
        runs: runSummaries,
      };
    })();

    try {
      return await activeSyncPromise;
    } finally {
      activeSyncPromise = null;
    }
  }

  return {
    DRIVE_FILE_SCOPE,
    DEFAULT_ROOT_FOLDER_NAME,
    SUBFOLDER_DEFINITIONS,
    resolveOAuthConfig,
    getStatus,
    hasValidAccessToken,
    setAccessTokenForSession,
    clearTokens,
    requestAuthorization,
    ensureFolderHierarchy,
    connectGoogleDrive,
    disconnectGoogleDrive,
    syncPendingWork,
  };
}
