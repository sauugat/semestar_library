/**
 * Semester Library — Teacher-Owned Google Drive Attendance Backup Sync Foundation (Web Client)
 *
 * Phase 3A Foundation Module (No UI):
 * - OAuth 2.0 configuration detection for Web, iOS, and Android client IDs (safe 'not_configured' state when missing)
 * - Google Identity Services (GIS) browser token client with narrow `https://www.googleapis.com/auth/drive.file` scope
 * - Strictly in-memory browser access token lifecycle (never persisted in localStorage, sessionStorage, or cookies)
 * - Zero token/secret transmission to Semester Library backend; error message and log sanitization
 * - Idempotent Google Drive folder hierarchy provisioning (`Semester Library Attendance Backups/` + 3 subfolders)
 * - Durable client-side artifact sync worker for `snapshot`, `daily_workbook`, and `annual_workbook`
 * - Lost-completion recovery via Drive `appProperties` and content SHA-256 verification
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.AttendanceDriveBackup = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (globalScope) {
  'use strict';

  const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
  const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
  const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
  const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
  const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const DEFAULT_ROOT_FOLDER_NAME = 'Semester Library Attendance Backups';
  const SUBFOLDER_DEFINITIONS = {
    daily: { key: 'dailyFolderId', name: 'Daily Attendance', role: 'daily_folder' },
    full: { key: 'fullFolderId', name: 'Full Attendance', role: 'full_folder' },
    snapshots: { key: 'snapshotsFolderId', name: 'Immutable Snapshots', role: 'snapshots_folder' }
  };

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
    'credentials'
  ]);

  const FORBIDDEN_TOKEN_VALUE_PATTERNS = [
    /^ya29\.[A-Za-z0-9._-]{10,}/,
    /^1\/\/[A-Za-z0-9._-]{10,}/,
    /^GOCSPX-[A-Za-z0-9._-]{8,}/,
    /^Bearer\s+[A-Za-z0-9._-]{10,}/i,
    /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/
  ];

  /**
   * Scrubs OAuth tokens, refresh tokens, client secrets, authorization codes, and claim tokens
   * from any error or diagnostic message before throwing or reporting.
   */
  function sanitizeClientErrorMessage(rawMessage) {
    if (rawMessage === null || rawMessage === undefined) return 'Google Drive operation failed.';
    let cleaned = String(rawMessage)
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

  function createClientError(code, rawMessage, extra = {}) {
    const safeMessage = sanitizeClientErrorMessage(rawMessage);
    const err = new Error(safeMessage);
    err.code = code || 'DRIVE_CLIENT_ERROR';
    Object.assign(err, extra);
    return err;
  }

  /**
   * Client-side outgoing payload guard: ensures no OAuth token, refresh token, authorization code,
   * or client secret is ever included in a request body sent to the Semester Library backend.
   */
  function assertNoSecretsInBackendPayload(payload, contextLabel = 'backend request') {
    if (!payload || typeof payload !== 'object') return;

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      for (const [rawKey, val] of Object.entries(node)) {
        const normKey = String(rawKey).trim().toLowerCase();
        if (FORBIDDEN_SECRET_KEYS.has(normKey)) {
          throw createClientError(
            'SENSITIVE_TOKEN_FORBIDDEN',
            `Blocked attempt to send forbidden credential field "${rawKey}" in ${contextLabel}.`
          );
        }
        if (typeof val === 'string') {
          const trimmed = val.trim();
          for (const pattern of FORBIDDEN_TOKEN_VALUE_PATTERNS) {
            if (pattern.test(trimmed)) {
              throw createClientError(
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
   * Matches backend serializeCanonicalJson() byte-for-byte.
   */
  function serializeCanonicalJson(value) {
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

  function utf8ToBytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(String(str));
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(String(str), 'utf8'));
    }
    const raw = unescape(encodeURIComponent(String(str)));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function base64ToBytes(b64) {
    const clean = String(b64 || '').trim();
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(clean, 'base64'));
    }
    if (typeof atob === 'function') {
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    throw createClientError('BASE64_DECODE_UNAVAILABLE', 'Base64 decoding is unavailable in this runtime.');
  }

  function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    }
    let binary = '';
    for (let i = 0; i < u8.byteLength; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return btoa(binary);
  }

  /**
   * Computes a 64-character lowercase hex SHA-256 digest of a Uint8Array or UTF-8 string.
   */
  async function computeSha256Hex(input) {
    const bytes = input instanceof Uint8Array ? input : utf8ToBytes(String(input));
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const digestBuf = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digestBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    if (typeof require === 'function') {
      try {
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
      } catch (_) {}
    }
    throw createClientError('SHA256_UNAVAILABLE', 'SHA-256 digest computation is unavailable.');
  }

  /**
   * Escapes single quotes and backslashes for Google Drive search queries (`q` parameter).
   */
  function escapeDriveQueryValue(val) {
    return String(val || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  /**
   * Builds a RFC 2046 multipart/related payload for Google Drive v3 file creation or update.
   */
  function buildMultipartRelatedBody(metadata, contentBytes, contentMimeType) {
    const boundary = '-------SemesterLibraryDriveSyncBoundary7MA4YWxkTrZu0gW';
    const metaJson = JSON.stringify(metadata || {});
    const isBinary = contentMimeType !== 'application/json' && !String(contentMimeType).startsWith('text/');

    let contentPartBody;
    let transferEncodingHeader = '';
    if (isBinary) {
      transferEncodingHeader = 'Content-Transfer-Encoding: base64\r\n';
      contentPartBody = bytesToBase64(contentBytes);
    } else {
      contentPartBody =
        contentBytes instanceof Uint8Array
          ? typeof TextDecoder !== 'undefined'
            ? new TextDecoder('utf-8').decode(contentBytes)
            : Buffer.from(contentBytes).toString('utf8')
          : String(contentBytes);
    }

    const bodyString =
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
      body: bodyString
    };
  }

  /**
   * Creates an isolated client-side Attendance Drive Backup controller instance.
   */
  function createAttendanceDriveSyncClient(options = {}) {
    const win = options.window || globalScope;
    const rawDriveFetch = options.driveFetch || (win && win.fetch ? win.fetch.bind(win) : null);
    const rawBackendFetch =
      options.backendFetch ||
      (win && win.SemesterAuth && typeof win.SemesterAuth.authFetch === 'function'
        ? win.SemesterAuth.authFetch.bind(win.SemesterAuth)
        : win && win.fetch
        ? win.fetch.bind(win)
        : null);

    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
    const clientIdTag =
      options.clientId ||
      `web_drive_sync_${Math.random().toString(36).slice(2, 10)}`;

    // Strictly in-memory OAuth token state (NEVER written to localStorage or sessionStorage)
    let inMemoryToken = null; // { accessToken, expiresAtMs, scope, tokenType }
    let cachedOAuthConfig = options.oauthConfig || null;
    let cachedConnection = null;
    let gisLoadPromise = null;
    let activeSyncPromise = null;
    let activeProvisionPromise = null;

    /**
     * Purges any accidental Google Drive token keys if any external script ever placed them in web storage.
     */
    function enforceZeroBrowserTokenStorage() {
      try {
        for (const storage of [win && win.localStorage, win && win.sessionStorage]) {
          if (!storage || typeof storage.length !== 'number') continue;
          for (let i = storage.length - 1; i >= 0; i--) {
            const k = storage.key(i);
            if (k && /google_drive.*token|gis_access_token|drive_oauth_token/i.test(k)) {
              storage.removeItem(k);
            }
          }
        }
      } catch (_) {}
    }

    enforceZeroBrowserTokenStorage();

    /**
     * Resolves OAuth configuration from explicit options, window globals, or backend `/api/attendance/backup/status`.
     */
    function resolveLocalOAuthConfig(serverOAuth = null) {
      const envWebId = String(
        options.webClientId ||
          (cachedOAuthConfig && cachedOAuthConfig.webClientId) ||
          (serverOAuth && serverOAuth.webClientId) ||
          (win && (win.GOOGLE_DRIVE_WEB_CLIENT_ID || win.EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID)) ||
          ''
      ).trim();

      const envIosId = String(
        options.iosClientId ||
          (cachedOAuthConfig && cachedOAuthConfig.iosClientId) ||
          (serverOAuth && serverOAuth.iosClientId) ||
          (win && (win.GOOGLE_DRIVE_IOS_CLIENT_ID || win.EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID)) ||
          ''
      ).trim();

      const envAndroidId = String(
        options.androidClientId ||
          (cachedOAuthConfig && cachedOAuthConfig.androidClientId) ||
          (serverOAuth && serverOAuth.androidClientId) ||
          (win && (win.GOOGLE_DRIVE_ANDROID_CLIENT_ID || win.EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID)) ||
          ''
      ).trim();

      const webConfigured = Boolean(envWebId || (serverOAuth && serverOAuth.webConfigured));
      const iosConfigured = Boolean(envIosId || (serverOAuth && serverOAuth.iosConfigured));
      const androidConfigured = Boolean(envAndroidId || (serverOAuth && serverOAuth.androidConfigured));
      const configured = Boolean(webConfigured);

      return {
        platform: 'web',
        configured,
        status: configured ? 'configured' : 'not_configured',
        webConfigured,
        iosConfigured,
        androidConfigured,
        webClientId: envWebId || null,
        iosClientId: envIosId || null,
        androidClientId: envAndroidId || null,
        scope: DRIVE_FILE_SCOPE
      };
    }

    /**
     * Calls a Semester Library backend API endpoint with strict secret-prevention guards.
     */
    async function callBackendJson(path, fetchOptions = {}) {
      if (!rawBackendFetch) {
        throw createClientError('BACKEND_FETCH_UNAVAILABLE', 'Backend fetch function is not available.');
      }

      const method = String(fetchOptions.method || 'GET').toUpperCase();
      const headers = {
        Accept: 'application/json',
        ...(fetchOptions.headers || {})
      };

      // Verify no Google OAuth token is ever placed into backend Authorization header
      if (headers.Authorization || headers.authorization) {
        const authVal = String(headers.Authorization || headers.authorization);
        if (/ya29\./.test(authVal) || (inMemoryToken && authVal.includes(inMemoryToken.accessToken))) {
          throw createClientError(
            'SENSITIVE_TOKEN_FORBIDDEN',
            'Blocked attempt to send Google OAuth access token to Semester Library backend.'
          );
        }
      }

      let bodyStr = undefined;
      if (fetchOptions.body !== undefined && fetchOptions.body !== null) {
        const bodyObj =
          typeof fetchOptions.body === 'string' ? JSON.parse(fetchOptions.body) : fetchOptions.body;
        assertNoSecretsInBackendPayload(bodyObj, `${method} ${path}`);
        headers['Content-Type'] = 'application/json';
        bodyStr = JSON.stringify(bodyObj);
      }

      const res = await rawBackendFetch(path, {
        ...fetchOptions,
        method,
        headers,
        body: bodyStr
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw createClientError(
          data.code || data.error || `HTTP_${res.status}`,
          data.message || `Backend request ${method} ${path} failed (${res.status}).`,
          { status: res.status, data }
        );
      }
      return data;
    }

    async function callBackendWorkbookJson(path) {
      const sep = path.includes('?') ? '&' : '?';
      return await callBackendJson(`${path}${sep}format=json`, { method: 'GET' });
    }

    /**
     * Fetches the current Google Drive backup configuration and connection status from the backend.
     */
    async function getStatus() {
      const statusData = await callBackendJson('/api/attendance/backup/status', { method: 'GET' });
      if (statusData && statusData.oauth) {
        cachedOAuthConfig = resolveLocalOAuthConfig(statusData.oauth);
      } else {
        cachedOAuthConfig = resolveLocalOAuthConfig();
      }
      cachedConnection = statusData.connection || null;

      return {
        ...statusData,
        oauth: cachedOAuthConfig,
        hasActiveMemoryToken: hasValidAccessToken()
      };
    }

    function hasValidAccessToken() {
      if (!inMemoryToken || !inMemoryToken.accessToken) return false;
      // 30-second expiry safety buffer
      return inMemoryToken.expiresAtMs - 30_000 > nowFn();
    }

    function clearAccessToken() {
      inMemoryToken = null;
      enforceZeroBrowserTokenStorage();
    }

    function setAccessTokenForSession({ accessToken, expiresInSeconds = 3600, scope = DRIVE_FILE_SCOPE }) {
      const cleanToken = String(accessToken || '').trim();
      if (!cleanToken) {
        throw createClientError('OAUTH_TOKEN_MISSING', 'Google OAuth did not return an access token.');
      }
      const ttlMs = Math.max(60, Number(expiresInSeconds) || 3600) * 1000;
      inMemoryToken = {
        accessToken: cleanToken,
        expiresAtMs: nowFn() + ttlMs,
        scope: String(scope || DRIVE_FILE_SCOPE),
        tokenType: 'Bearer'
      };
      enforceZeroBrowserTokenStorage();
      return {
        authorized: true,
        expiresAt: new Date(inMemoryToken.expiresAtMs).toISOString(),
        scope: inMemoryToken.scope
      };
    }

    /**
     * Dynamically loads the Google Identity Services script (`https://accounts.google.com/gsi/client`)
     * if not already present on `window.google.accounts.oauth2`.
     */
    async function ensureGoogleIdentityServicesLoaded() {
      if (win && win.google && win.google.accounts && win.google.accounts.oauth2) {
        return win.google.accounts.oauth2;
      }
      if (typeof options.loadGisSdk === 'function') {
        return await options.loadGisSdk();
      }
      if (!win || !win.document || typeof win.document.createElement !== 'function') {
        throw createClientError(
          'GIS_SDK_UNAVAILABLE',
          'Google Identity Services SDK is not loaded in this environment.'
        );
      }
      if (!gisLoadPromise) {
        gisLoadPromise = new Promise((resolve, reject) => {
          const script = win.document.createElement('script');
          script.src = GIS_SCRIPT_SRC;
          script.async = true;
          script.defer = true;
          script.onload = () => {
            if (win.google && win.google.accounts && win.google.accounts.oauth2) {
              resolve(win.google.accounts.oauth2);
            } else {
              gisLoadPromise = null;
              reject(createClientError('GIS_SDK_LOAD_ERROR', 'Google Identity Services loaded without oauth2 client.'));
            }
          };
          script.onerror = () => {
            gisLoadPromise = null;
            reject(createClientError('GIS_SDK_LOAD_ERROR', 'Failed to load Google Identity Services script.'));
          };
          win.document.head.appendChild(script);
        });
      }
      return await gisLoadPromise;
    }

    /**
     * Requests interactive Google OAuth authorization via Google Identity Services token client.
     * Must be triggered from a user gesture when interactive prompt is required.
     */
    async function requestAuthorization({ userGesture = false, prompt = '' } = {}) {
      let cfg = resolveLocalOAuthConfig(cachedOAuthConfig);
      if (!cfg.webClientId) {
        try {
          const remoteStatus = await getStatus();
          cfg = remoteStatus.oauth;
        } catch (_) {}
      }

      if (!cfg.configured || !cfg.webClientId) {
        return {
          authorized: false,
          notConfigured: true,
          status: 'not_configured',
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'Google Drive OAuth Web Client ID is not configured.'
        };
      }

      if (!userGesture && !hasValidAccessToken()) {
        throw createClientError(
          'USER_GESTURE_REQUIRED',
          'Interactive Google Drive authorization must be initiated from a user gesture.'
        );
      }

      if (hasValidAccessToken() && prompt !== 'consent') {
        return {
          authorized: true,
          notConfigured: false,
          status: 'authorized',
          expiresAt: new Date(inMemoryToken.expiresAtMs).toISOString(),
          scope: inMemoryToken.scope
        };
      }

      const oauth2 = await ensureGoogleIdentityServicesLoaded();

      return await new Promise((resolve, reject) => {
        let settled = false;
        const finishResolve = (val) => {
          if (settled) return;
          settled = true;
          resolve(val);
        };
        const finishReject = (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        try {
          const tokenClient = oauth2.initTokenClient({
            client_id: cfg.webClientId,
            scope: DRIVE_FILE_SCOPE,
            callback: (tokenResponse) => {
              if (!tokenResponse || tokenResponse.error) {
                const errType = String((tokenResponse && tokenResponse.error) || 'oauth_error').toLowerCase();
                if (errType === 'access_denied' || errType === 'user_cancel' || errType.includes('cancel')) {
                  finishReject(
                    createClientError(
                      'OAUTH_CANCELLED',
                      tokenResponse.error_description || 'Google Drive authorization was cancelled or denied by the user.'
                    )
                  );
                  return;
                }
                finishReject(
                  createClientError(
                    'OAUTH_AUTHORIZATION_ERROR',
                    tokenResponse.error_description || `Google OAuth error: ${errType}`
                  )
                );
                return;
              }

              const grantedScope = String(tokenResponse.scope || '');
              if (
                typeof oauth2.hasGrantedAllScopes === 'function' &&
                !oauth2.hasGrantedAllScopes(tokenResponse, DRIVE_FILE_SCOPE)
              ) {
                finishReject(
                  createClientError(
                    'OAUTH_SCOPE_MISSING',
                    'Required Google Drive file permission (drive.file) was not granted.'
                  )
                );
                return;
              } else if (grantedScope && !grantedScope.includes('drive.file')) {
                finishReject(
                  createClientError(
                    'OAUTH_SCOPE_MISSING',
                    'Required Google Drive file permission (drive.file) was not granted.'
                  )
                );
                return;
              }

              const sessionInfo = setAccessTokenForSession({
                accessToken: tokenResponse.access_token,
                expiresInSeconds: Number(tokenResponse.expires_in) || 3600,
                scope: grantedScope || DRIVE_FILE_SCOPE
              });
              finishResolve({
                authorized: true,
                notConfigured: false,
                status: 'authorized',
                ...sessionInfo
              });
            },
            error_callback: (err) => {
              const errType = String((err && err.type) || (err && err.message) || 'popup_closed').toLowerCase();
              if (errType.includes('popup_closed') || errType.includes('cancel')) {
                finishReject(
                  createClientError('OAUTH_CANCELLED', 'Google authorization popup was closed before completing sign-in.')
                );
                return;
              }
              finishReject(
                createClientError('OAUTH_POPUP_ERROR', `Google authorization popup failed: ${errType}`)
              );
            }
          });

          tokenClient.requestAccessToken({ prompt });
        } catch (initErr) {
          finishReject(createClientError('OAUTH_INIT_FAILED', initErr.message || 'Failed to initialize Google OAuth.'));
        }
      });
    }

    /**
     * Makes an authenticated Google Drive v3 REST API call using the in-memory access token.
     */
    async function driveApiRequest(urlOrPath, fetchOptions = {}) {
      if (!rawDriveFetch) {
        throw createClientError('DRIVE_FETCH_UNAVAILABLE', 'Global fetch is unavailable for Google Drive requests.');
      }
      if (!hasValidAccessToken()) {
        clearAccessToken();
        throw createClientError(
          'DRIVE_AUTH_EXPIRED',
          'Google Drive access token is missing or expired. Reconnection is required.',
          { reconnectRequired: true, status: 401 }
        );
      }

      const url = urlOrPath.startsWith('http') ? urlOrPath : `${DRIVE_API_BASE}${urlOrPath}`;
      const headers = {
        Accept: 'application/json',
        ...(fetchOptions.headers || {}),
        Authorization: `Bearer ${inMemoryToken.accessToken}`
      };

      let res;
      try {
        res = await rawDriveFetch(url, {
          ...fetchOptions,
          headers
        });
      } catch (netErr) {
        throw createClientError(
          'DRIVE_NETWORK_ERROR',
          netErr.message || 'Network error while communicating with Google Drive.',
          { reconnectRequired: false }
        );
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        const errReason =
          (data &&
            data.error &&
            Array.isArray(data.error.errors) &&
            data.error.errors[0] &&
            data.error.errors[0].reason) ||
          '';
        const errMessage = (data && data.error && data.error.message) || `Google Drive authorization error (${res.status})`;
        const isQuotaOrRateLimit =
          res.status === 403 &&
          /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|sharingRateLimitExceeded/i.test(errReason);

        if (!isQuotaOrRateLimit) {
          clearAccessToken();
          throw createClientError('DRIVE_AUTH_EXPIRED', errMessage, {
            reconnectRequired: true,
            status: res.status
          });
        }

        throw createClientError('DRIVE_RATE_LIMIT', errMessage, {
          reconnectRequired: false,
          status: res.status
        });
      }

      if (!res.ok) {
        const errMessage =
          (data && data.error && data.error.message) || `Google Drive request failed with HTTP ${res.status}.`;
        throw createClientError(`DRIVE_HTTP_${res.status}`, errMessage, {
          reconnectRequired: false,
          status: res.status
        });
      }

      return data;
    }

    /**
     * Checks whether a saved Google Drive folder ID exists, is a folder, and is not trashed.
     */
    async function verifyFolderAccessible(folderId) {
      if (!folderId || typeof folderId !== 'string' || !folderId.trim()) return null;
      const cleanId = folderId.trim();
      try {
        const meta = await driveApiRequest(
          `/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType,trashed,appProperties`,
          { method: 'GET' }
        );
        if (!meta || meta.trashed === true || meta.mimeType !== FOLDER_MIME_TYPE) {
          return null;
        }
        return meta;
      } catch (err) {
        if (err && err.reconnectRequired) throw err;
        if (err && err.status === 404) return null;
        throw err;
      }
    }

    /**
     * Searches Google Drive for an existing non-trashed folder matching name (and optional parentId/appProperties).
     * Note: Google Drive does not enforce folder name uniqueness; if multiple matching folders exist,
     * we deterministically select the earliest created folder (`orderBy=createdTime asc`).
     */
    async function searchExistingFolder({ name, parentId = null, folderRole = null }) {
      const clauses = [
        `mimeType = '${FOLDER_MIME_TYPE}'`,
        `trashed = false`,
        `name = '${escapeDriveQueryValue(name)}'`
      ];
      if (parentId) {
        clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
      }
      if (folderRole) {
        clauses.push(`appProperties has { key='slFolderRole' and value='${escapeDriveQueryValue(folderRole)}' }`);
      }

      const q = clauses.join(' and ');
      const path = `/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,appProperties)&orderBy=createdTime%20asc&pageSize=10`;
      const data = await driveApiRequest(path, { method: 'GET' });
      const files = (data && Array.isArray(data.files) ? data.files : []);
      if (files.length > 0) {
        return files[0];
      }

      // Fallback search by name + parent without appProperties in case folder was created without slFolderRole tag
      if (folderRole) {
        const fallbackClauses = [
          `mimeType = '${FOLDER_MIME_TYPE}'`,
          `trashed = false`,
          `name = '${escapeDriveQueryValue(name)}'`
        ];
        if (parentId) {
          fallbackClauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
        }
        const fallbackQ = fallbackClauses.join(' and ');
        const fallbackPath = `/files?q=${encodeURIComponent(fallbackQ)}&fields=files(id,name,createdTime,appProperties)&orderBy=createdTime%20asc&pageSize=10`;
        const fallbackData = await driveApiRequest(fallbackPath, { method: 'GET' });
        const fallbackFiles = (fallbackData && Array.isArray(fallbackData.files) ? fallbackData.files : []);
        if (fallbackFiles.length > 0) {
          return fallbackFiles[0];
        }
      }

      return null;
    }

    async function createDriveFolder({ name, parentId = null, folderRole = null }) {
      const metadata = {
        name,
        mimeType: FOLDER_MIME_TYPE,
        appProperties: {
          slApp: 'semester_library',
          ...(folderRole ? { slFolderRole: folderRole } : {})
        }
      };
      if (parentId) {
        metadata.parents = [parentId];
      }
      return await driveApiRequest('/files?fields=id,name,mimeType,appProperties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata)
      });
    }

    async function resolveOrCreateFolder({ savedFolderId, name, parentId = null, folderRole = null }) {
      if (savedFolderId) {
        const verified = await verifyFolderAccessible(savedFolderId);
        if (verified) {
          return { id: verified.id, name: verified.name || name, reused: true, source: 'saved_id' };
        }
      }

      const found = await searchExistingFolder({ name, parentId, folderRole });
      if (found && found.id) {
        return { id: found.id, name: found.name || name, reused: true, source: 'search' };
      }

      const created = await createDriveFolder({ name, parentId, folderRole });
      return { id: created.id, name: created.name || name, reused: false, source: 'created' };
    }

    /**
     * Provisions or reuses the teacher's Google Drive folder hierarchy:
     *   Semester Library Attendance Backups/
     *     ├── Daily Attendance/
     *     ├── Full Attendance/
     *     └── Immutable Snapshots/
     * Persists only non-secret folder IDs and connection status via `PUT /api/attendance/backup/connection`.
     */
    async function ensureFolderHierarchy({ googleEmail = null } = {}) {
      if (activeProvisionPromise) {
        return await activeProvisionPromise;
      }

      activeProvisionPromise = (async () => {
        const statusData = await getStatus();
        const savedConn = statusData.connection || {};

        let resolvedEmail = googleEmail || savedConn.googleEmail || null;
        if (!resolvedEmail) {
          try {
            const about = await driveApiRequest('/about?fields=user(emailAddress)', { method: 'GET' });
            if (about && about.user && about.user.emailAddress) {
              resolvedEmail = String(about.user.emailAddress).trim().toLowerCase();
            }
          } catch (err) {
            if (err && err.reconnectRequired) throw err;
          }
        }

        const rootFolderName = savedConn.rootFolderName || DEFAULT_ROOT_FOLDER_NAME;
        const rootFolder = await resolveOrCreateFolder({
          savedFolderId: savedConn.rootFolderId,
          name: rootFolderName,
          parentId: null,
          folderRole: 'root_folder'
        });

        const dailyFolder = await resolveOrCreateFolder({
          savedFolderId: savedConn.dailyFolderId,
          name: SUBFOLDER_DEFINITIONS.daily.name,
          parentId: rootFolder.id,
          folderRole: SUBFOLDER_DEFINITIONS.daily.role
        });

        const fullFolder = await resolveOrCreateFolder({
          savedFolderId: savedConn.fullFolderId,
          name: SUBFOLDER_DEFINITIONS.full.name,
          parentId: rootFolder.id,
          folderRole: SUBFOLDER_DEFINITIONS.full.role
        });

        const snapshotsFolder = await resolveOrCreateFolder({
          savedFolderId: savedConn.snapshotsFolderId,
          name: SUBFOLDER_DEFINITIONS.snapshots.name,
          parentId: rootFolder.id,
          folderRole: SUBFOLDER_DEFINITIONS.snapshots.role
        });

        const connectionPayload = {
          connectionStatus: 'connected',
          rootFolderId: rootFolder.id,
          rootFolderName,
          dailyFolderId: dailyFolder.id,
          fullFolderId: fullFolder.id,
          snapshotsFolderId: snapshotsFolder.id,
          ...(resolvedEmail ? { googleEmail: resolvedEmail } : {})
        };

        const savedResult = await callBackendJson('/api/attendance/backup/connection', {
          method: 'PUT',
          body: connectionPayload
        });

        cachedConnection = savedResult.connection || null;
        return {
          connected: true,
          folders: {
            rootFolderId: rootFolder.id,
            rootFolderName,
            dailyFolderId: dailyFolder.id,
            fullFolderId: fullFolder.id,
            snapshotsFolderId: snapshotsFolder.id
          },
          resolution: {
            root: rootFolder.source,
            daily: dailyFolder.source,
            full: fullFolder.source,
            snapshots: snapshotsFolder.source
          },
          connection: cachedConnection
        };
      })();

      try {
        return await activeProvisionPromise;
      } finally {
        activeProvisionPromise = null;
      }
    }

    /**
     * Connects Google Drive (authorizes via GIS and provisions/reuses the folder hierarchy).
     */
    async function connectGoogleDrive({ userGesture = true, prompt = '', googleEmail = null } = {}) {
      const authResult = await requestAuthorization({ userGesture, prompt });
      if (authResult.notConfigured) {
        return authResult;
      }
      const provisioned = await ensureFolderHierarchy({ googleEmail });
      return {
        authorized: true,
        notConfigured: false,
        status: 'connected',
        ...provisioned
      };
    }

    /**
     * Disconnects Google Drive without deleting any Drive folders or user files.
     * Clears the in-memory OAuth token, best-effort revokes the token with Google,
     * and notifies `POST /api/attendance/backup/disconnect` to revoke active server leases.
     */
    async function disconnectGoogleDrive({ clearFolders = false } = {}) {
      const tokenToRevoke = inMemoryToken ? inMemoryToken.accessToken : null;
      clearAccessToken();

      if (tokenToRevoke && rawDriveFetch) {
        try {
          await rawDriveFetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(tokenToRevoke)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
        } catch (_) {}
      }

      const disconnectResult = await callBackendJson('/api/attendance/backup/disconnect', {
        method: 'POST',
        body: { clearFolders: Boolean(clearFolders) }
      });
      cachedConnection = disconnectResult.connection || null;
      return disconnectResult;
    }

    /**
     * Searches a target folder for an existing Drive file by deterministic appProperties or filename.
     */
    async function findExistingArtifactFile({
      folderId,
      savedDriveFileId = null,
      artifactType,
      targetScopeKey,
      driveFileName
    }) {
      // 1. If the artifact row already recorded a driveFileId, check if it exists and is accessible
      if (savedDriveFileId) {
        try {
          const meta = await driveApiRequest(
            `/files/${encodeURIComponent(savedDriveFileId)}?fields=id,name,mimeType,trashed,sha256Checksum,appProperties`,
            { method: 'GET' }
          );
          if (meta && !meta.trashed) {
            return meta;
          }
        } catch (err) {
          if (err && err.reconnectRequired) throw err;
          if (!err || err.status !== 404) throw err;
        }
      }

      // 2. Search by deterministic targetScopeKey + artifactType in appProperties
      const propClauses = [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        `trashed = false`,
        `appProperties has { key='slArtifactType' and value='${escapeDriveQueryValue(artifactType)}' }`,
        `appProperties has { key='slScopeKey' and value='${escapeDriveQueryValue(targetScopeKey)}' }`
      ];
      const propQuery = propClauses.join(' and ');
      const propRes = await driveApiRequest(
        `/files?q=${encodeURIComponent(propQuery)}&fields=files(id,name,mimeType,sha256Checksum,appProperties,createdTime)&orderBy=createdTime%20asc&pageSize=5`,
        { method: 'GET' }
      );
      if (propRes && Array.isArray(propRes.files) && propRes.files.length > 0) {
        return propRes.files[0];
      }

      // 3. Fallback search by exact filename inside the target folder
      if (driveFileName) {
        const nameClauses = [
          `'${escapeDriveQueryValue(folderId)}' in parents`,
          `trashed = false`,
          `name = '${escapeDriveQueryValue(driveFileName)}'`
        ];
        const nameQuery = nameClauses.join(' and ');
        const nameRes = await driveApiRequest(
          `/files?q=${encodeURIComponent(nameQuery)}&fields=files(id,name,mimeType,sha256Checksum,appProperties,createdTime)&orderBy=createdTime%20asc&pageSize=5`,
          { method: 'GET' }
        );
        if (nameRes && Array.isArray(nameRes.files) && nameRes.files.length > 0) {
          return nameRes.files[0];
        }
      }

      return null;
    }

    /**
     * Uploads or updates a single artifact (`snapshot`, `daily_workbook`, or `annual_workbook`)
     * idempotently in Google Drive.
     *
     * Policy:
     * - `snapshot`: Immutable per revision (`session:<sessionId>:v<revisionNo>`).
     *   If the file already exists in Drive (e.g. lost completion response on a previous attempt)
     *   and its content hash matches `snapshotSha256`, reuse it without overwriting or creating a duplicate!
     *   Never overwrite an existing historical snapshot file.
     * - `daily_workbook` / `annual_workbook`: Mutable report files (`daily:<teacherId>:<date>`, `annual:<teacherId>:<year>`).
     *   If the existing Drive file already has `slArtifactSha256 === artifactSha256`, skip re-uploading bytes and reuse `id`.
     *   If an existing Drive file has a higher `slRevisionNo` for the same session, refuse to downgrade it.
     *   Otherwise update the existing file via `PATCH /upload/drive/v3/files/:fileId?uploadType=multipart`.
     */
    async function uploadOrReconcileArtifactToDrive({
      artifactMeta,
      claimedItem,
      runBundle,
      folders
    }) {
      const artifactType = claimedItem.artifactType;
      const revisionNo = Number(runBundle.revisionNo);
      const snapshotSha256 = String(runBundle.snapshotSha256).toLowerCase();
      const sessionId = String(runBundle.sessionId);
      const targetScopeKey =
        (artifactMeta && artifactMeta.targetScopeKey) ||
        (artifactType === 'snapshot'
          ? `session:${sessionId}:v${revisionNo}`
          : artifactType === 'daily_workbook'
          ? `daily:${runBundle.teacherId}:${runBundle.workbooks.daily.date}`
          : `annual:${runBundle.teacherId}:${runBundle.workbooks.annual.year}`);

      let folderId;
      let driveFileName;
      let mimeType;
      let contentBytes;
      let artifactSha256;

      if (artifactType === 'snapshot') {
        folderId = folders.snapshotsFolderId;
        driveFileName =
          claimedItem.driveFileName ||
          (artifactMeta && artifactMeta.driveFileName) ||
          runBundle.snapshot.filename;
        mimeType = 'application/json';

        const canonicalJsonStr = serializeCanonicalJson(runBundle.snapshot.payload);
        contentBytes = utf8ToBytes(canonicalJsonStr);
        const computedSha = await computeSha256Hex(contentBytes);
        if (computedSha !== snapshotSha256) {
          throw createClientError(
            'SNAPSHOT_INTEGRITY_MISMATCH',
            `Canonical snapshot SHA-256 mismatch: expected ${snapshotSha256}, computed ${computedSha}.`
          );
        }
        artifactSha256 = snapshotSha256;
      } else if (artifactType === 'daily_workbook') {
        folderId = folders.dailyFolderId;
        let wbBundle = runBundle.workbooks && runBundle.workbooks.daily && runBundle.workbooks.daily.bundle;
        if (!wbBundle || !wbBundle.base64) {
          wbBundle = await callBackendWorkbookJson(runBundle.workbooks.daily.downloadPath);
        }
        driveFileName =
          claimedItem.driveFileName ||
          (artifactMeta && artifactMeta.driveFileName) ||
          wbBundle.filename;
        mimeType = wbBundle.mimeType || XLSX_MIME_TYPE;
        contentBytes = base64ToBytes(wbBundle.base64);
        const computedSha = await computeSha256Hex(contentBytes);
        if (wbBundle.sha256 && computedSha !== String(wbBundle.sha256).toLowerCase()) {
          throw createClientError(
            'WORKBOOK_INTEGRITY_MISMATCH',
            'Downloaded daily workbook SHA-256 did not match server header.'
          );
        }
        artifactSha256 = computedSha;
      } else if (artifactType === 'annual_workbook') {
        folderId = folders.fullFolderId;
        let wbBundle = runBundle.workbooks && runBundle.workbooks.annual && runBundle.workbooks.annual.bundle;
        if (!wbBundle || !wbBundle.base64) {
          wbBundle = await callBackendWorkbookJson(runBundle.workbooks.annual.downloadPath);
        }
        driveFileName =
          claimedItem.driveFileName ||
          (artifactMeta && artifactMeta.driveFileName) ||
          wbBundle.filename;
        mimeType = wbBundle.mimeType || XLSX_MIME_TYPE;
        contentBytes = base64ToBytes(wbBundle.base64);
        const computedSha = await computeSha256Hex(contentBytes);
        if (wbBundle.sha256 && computedSha !== String(wbBundle.sha256).toLowerCase()) {
          throw createClientError(
            'WORKBOOK_INTEGRITY_MISMATCH',
            'Downloaded annual workbook SHA-256 did not match server header.'
          );
        }
        artifactSha256 = computedSha;
      } else {
        throw createClientError('INVALID_ARTIFACT_TYPE', `Unsupported artifactType "${artifactType}".`);
      }

      const appProperties = {
        slApp: 'semester_library',
        slArtifactType: artifactType,
        slScopeKey: targetScopeKey,
        slSessionId: sessionId,
        slRevisionNo: String(revisionNo),
        slSnapshotSha256: snapshotSha256,
        slArtifactSha256: artifactSha256
      };

      const existingFile = await findExistingArtifactFile({
        folderId,
        savedDriveFileId: artifactMeta ? artifactMeta.driveFileId : null,
        artifactType,
        targetScopeKey,
        driveFileName
      });

      if (existingFile && existingFile.id) {
        const existingProps = existingFile.appProperties || {};
        const existingSha = String(
          existingProps.slArtifactSha256 || existingFile.sha256Checksum || ''
        ).toLowerCase();

        if (artifactType === 'snapshot') {
          // Immutable snapshot policy: NEVER overwrite an existing snapshot file!
          if (existingSha && existingSha !== artifactSha256) {
            throw createClientError(
              'IMMUTABLE_SNAPSHOT_CONFLICT',
              `Existing snapshot file in Google Drive has a different SHA-256 (${existingSha.slice(0, 12)}...). Refusing to overwrite immutable snapshot.`
            );
          }
          return {
            driveFileId: existingFile.id,
            driveFileName: existingFile.name || driveFileName,
            artifactSha256,
            reusedExistingFile: true
          };
        }

        // Mutable workbook policy: prevent stale revision from overwriting a newer revision of the same session
        if (
          existingProps.slSessionId === sessionId &&
          existingProps.slRevisionNo &&
          Number(existingProps.slRevisionNo) > revisionNo
        ) {
          throw createClientError(
            'STALE_REVISION_WORKBOOK',
            `Drive workbook already reflects newer revision v${existingProps.slRevisionNo} (current run is v${revisionNo}).`
          );
        }

        // Lost-completion idempotency: if Drive file already has the exact same content SHA-256, reuse without re-uploading
        if (existingSha === artifactSha256) {
          return {
            driveFileId: existingFile.id,
            driveFileName: existingFile.name || driveFileName,
            artifactSha256,
            reusedExistingFile: true
          };
        }

        // Update existing mutable workbook file in place
        const patchMultipart = buildMultipartRelatedBody(
          {
            name: driveFileName,
            appProperties
          },
          contentBytes,
          mimeType
        );

        const updatedFile = await driveApiRequest(
          `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFile.id)}?uploadType=multipart&fields=id,name,sha256Checksum,appProperties`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': patchMultipart.contentType },
            body: patchMultipart.body
          }
        );

        return {
          driveFileId: updatedFile.id || existingFile.id,
          driveFileName: updatedFile.name || driveFileName,
          artifactSha256,
          reusedExistingFile: false
        };
      }

      // Create new file inside the target subfolder
      const createMultipart = buildMultipartRelatedBody(
        {
          name: driveFileName,
          mimeType,
          parents: [folderId],
          appProperties
        },
        contentBytes,
        mimeType
      );

      const createdFile = await driveApiRequest(
        `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,sha256Checksum,appProperties`,
        {
          method: 'POST',
          headers: { 'Content-Type': createMultipart.contentType },
          body: createMultipart.body
        }
      );

      if (!createdFile || !createdFile.id) {
        throw createClientError('DRIVE_UPLOAD_EMPTY_ID', 'Google Drive upload did not return a valid file ID.');
      }

      return {
        driveFileId: createdFile.id,
        driveFileName: createdFile.name || driveFileName,
        artifactSha256,
        reusedExistingFile: false
      };
    }

    /**
     * Synchronizes all pending or retryable attendance backup runs for the authenticated teacher.
     * Single-flight guarded within the client instance so duplicate in-process calls coalesce cleanly.
     */
    async function syncPendingWork({
      sessionId = null,
      forceRetry = false,
      maxRuns = 25,
      leaseDurationMs = 120_000
    } = {}) {
      if (activeSyncPromise) {
        return await activeSyncPromise;
      }

      activeSyncPromise = (async () => {
        const statusInfo = await getStatus();
        if (!statusInfo.oauth || !statusInfo.oauth.configured) {
          return {
            synced: false,
            status: 'not_configured',
            notConfigured: true,
            processedRuns: 0,
            completedArtifacts: 0,
            failedArtifacts: 0,
            runs: []
          };
        }

        if (!hasValidAccessToken()) {
          return {
            synced: false,
            status: 'reconnect_required',
            reconnectRequired: true,
            processedRuns: 0,
            completedArtifacts: 0,
            failedArtifacts: 0,
            runs: []
          };
        }

        // Ensure folder hierarchy exists and is saved before claiming runs
        let folders;
        try {
          const folderRes = await ensureFolderHierarchy();
          folders = folderRes.folders;
        } catch (folderErr) {
          return {
            synced: false,
            status: folderErr.reconnectRequired ? 'reconnect_required' : 'failed',
            reconnectRequired: Boolean(folderErr.reconnectRequired),
            errorCode: folderErr.code || 'FOLDER_PROVISION_FAILED',
            errorMessage: sanitizeClientErrorMessage(folderErr.message),
            processedRuns: 0,
            completedArtifacts: 0,
            failedArtifacts: 0,
            runs: []
          };
        }

        const pendingQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const pendingData = await callBackendJson(`/api/attendance/backup/pending${pendingQuery}`, {
          method: 'GET'
        });

        const candidateRuns = Array.isArray(pendingData.runs) ? pendingData.runs.slice(0, maxRuns) : [];
        const runSummaries = [];
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

          let claimRes;
          try {
            claimRes = await callBackendJson(
              `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/claim`,
              {
                method: 'POST',
                body: {
                  clientId: clientIdTag,
                  leaseDurationMs,
                  forceRetry: Boolean(forceRetry),
                  revisionNo: pendingRun.revisionNo,
                  snapshotSha256: pendingRun.snapshotSha256
                }
              }
            );
          } catch (claimErr) {
            runSummaries.push({
              runId: pendingRun.id,
              claimed: false,
              skippedReason: claimErr.code || 'CLAIM_CONFLICT',
              message: sanitizeClientErrorMessage(claimErr.message)
            });
            continue;
          }

          if (!claimRes.claimed || !Array.isArray(claimRes.claimedArtifacts) || claimRes.claimedArtifacts.length === 0) {
            runSummaries.push({
              runId: pendingRun.id,
              claimed: false,
              alreadyBackedUp: Boolean(claimRes.alreadyBackedUp)
            });
            continue;
          }

          // Fetch exact immutable snapshot payload and server-generated workbooks for the claimed run
          let runBundle;
          try {
            runBundle = await callBackendJson(
              `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/artifacts?includePayloads=1`,
              { method: 'GET' }
            );
          } catch (bundleErr) {
            for (const claimedItem of claimRes.claimedArtifacts) {
              await callBackendJson(
                `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/fail`,
                {
                  method: 'POST',
                  body: {
                    artifactType: claimedItem.artifactType,
                    claimToken: claimedItem.claimToken,
                    errorCode: bundleErr.code || 'ARTIFACT_FETCH_FAILED',
                    errorMessage: sanitizeClientErrorMessage(bundleErr.message),
                    reconnectRequired: false
                  }
                }
              ).catch(() => {});
              totalFailedArtifacts += 1;
            }
            runSummaries.push({
              runId: pendingRun.id,
              claimed: true,
              status: 'failed',
              errorCode: bundleErr.code || 'ARTIFACT_FETCH_FAILED'
            });
            continue;
          }

          const artifactMetaByType = new Map(
            (runBundle.artifacts || []).map((a) => [a.artifactType, a])
          );
          const perArtifactOutcomes = [];

          for (const claimedItem of claimRes.claimedArtifacts) {
            const artMeta = artifactMetaByType.get(claimedItem.artifactType) || null;

            // Check if lease already expired locally before starting upload
            if (claimedItem.leaseExpiresAt && new Date(claimedItem.leaseExpiresAt).getTime() <= nowFn()) {
              perArtifactOutcomes.push({
                artifactType: claimedItem.artifactType,
                status: 'lease_expired'
              });
              totalFailedArtifacts += 1;
              continue;
            }

            try {
              const uploaded = await uploadOrReconcileArtifactToDrive({
                artifactMeta: artMeta,
                claimedItem,
                runBundle,
                folders
              });

              await callBackendJson(
                `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/complete`,
                {
                  method: 'POST',
                  body: {
                    artifactType: claimedItem.artifactType,
                    claimToken: claimedItem.claimToken,
                    revisionNo: runBundle.revisionNo,
                    snapshotSha256: runBundle.snapshotSha256,
                    driveFileId: uploaded.driveFileId,
                    driveFileName: uploaded.driveFileName,
                    artifactSha256: uploaded.artifactSha256
                  }
                }
              );

              totalCompletedArtifacts += 1;
              perArtifactOutcomes.push({
                artifactType: claimedItem.artifactType,
                status: 'backed_up',
                driveFileId: uploaded.driveFileId,
                reusedExistingFile: uploaded.reusedExistingFile
              });
            } catch (artErr) {
              const isReconnectRequired = Boolean(artErr && artErr.reconnectRequired);
              const errCode = artErr.code || (isReconnectRequired ? 'DRIVE_AUTH_EXPIRED' : 'DRIVE_UPLOAD_FAILED');
              const errMsg = sanitizeClientErrorMessage(artErr.message);

              // If completion failed because lease expired or revision was superseded on the server, do not overwrite server state
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
                    body: {
                      artifactType: claimedItem.artifactType,
                      claimToken: claimedItem.claimToken,
                      errorCode: errCode,
                      errorMessage: errMsg,
                      reconnectRequired: isReconnectRequired
                    }
                  }
                ).catch(() => {});
              }

              totalFailedArtifacts += 1;
              perArtifactOutcomes.push({
                artifactType: claimedItem.artifactType,
                status: isReconnectRequired ? 'reconnect_required' : 'failed',
                errorCode: errCode,
                errorMessage: errMsg
              });

              if (isReconnectRequired) {
                haltedByAuthExpiry = true;
                // Mark remaining claimed artifacts on this run as reconnect_required so they do not wait for lease timeout
                for (const sibling of claimRes.claimedArtifacts) {
                  if (sibling.artifactType === claimedItem.artifactType) continue;
                  const alreadyDone = perArtifactOutcomes.some((o) => o.artifactType === sibling.artifactType);
                  if (!alreadyDone) {
                    await callBackendJson(
                      `/api/attendance/backup/runs/${encodeURIComponent(pendingRun.id)}/fail`,
                      {
                        method: 'POST',
                        body: {
                          artifactType: sibling.artifactType,
                          claimToken: sibling.claimToken,
                          errorCode: 'DRIVE_AUTH_EXPIRED',
                          errorMessage: 'Google Drive authorization expired before upload could start.',
                          reconnectRequired: true
                        }
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
            artifacts: perArtifactOutcomes
          });
        }

        return {
          synced: !haltedByAuthExpiry && totalFailedArtifacts === 0,
          status: haltedByAuthExpiry
            ? 'reconnect_required'
            : totalFailedArtifacts > 0
            ? 'partial_or_failed'
            : 'backed_up',
          reconnectRequired: haltedByAuthExpiry,
          processedRuns: runSummaries.length,
          completedArtifacts: totalCompletedArtifacts,
          failedArtifacts: totalFailedArtifacts,
          runs: runSummaries
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
      sanitizeClientErrorMessage,
      assertNoSecretsInBackendPayload,
      serializeCanonicalJson,
      computeSha256Hex,
      resolveLocalOAuthConfig,
      getStatus,
      hasValidAccessToken,
      setAccessTokenForSession,
      clearAccessToken,
      requestAuthorization,
      ensureFolderHierarchy,
      connectGoogleDrive,
      disconnectGoogleDrive,
      syncPendingWork
    };
  }

  const defaultInstance = createAttendanceDriveSyncClient();
  return {
    ...defaultInstance,
    createAttendanceDriveSyncClient,
    DRIVE_FILE_SCOPE,
    DEFAULT_ROOT_FOLDER_NAME,
    SUBFOLDER_DEFINITIONS,
    sanitizeClientErrorMessage,
    assertNoSecretsInBackendPayload,
    serializeCanonicalJson,
    computeSha256Hex
  };
});
