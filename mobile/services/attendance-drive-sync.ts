/**
 * Semester Library — Teacher-Owned Google Drive Attendance Backup Sync Foundation (Mobile / Expo SDK 57)
 *
 * Binds `attendance-drive-sync-core.ts` to Expo SDK 57 runtime modules:
 * - `expo-web-browser` (`WebBrowser.openAuthSessionAsync`) for native OAuth 2.0 Authorization Code + PKCE (S256)
 * - `expo-secure-store` for hardware-encrypted refresh token persistence (never AsyncStorage or localStorage)
 * - `expo-constants` & `react-native` `Platform` for platform-specific iOS/Android Client ID resolution
 * - `apiFetch` for authenticated Semester Library backend API calls
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { apiFetch } from './api';
import {
  DRIVE_FILE_SCOPE,
  DRIVE_API_BASE,
  DRIVE_UPLOAD_BASE,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  FOLDER_MIME_TYPE,
  XLSX_MIME_TYPE,
  DEFAULT_ROOT_FOLDER_NAME,
  SECURE_STORE_REFRESH_TOKEN_KEY,
  SUBFOLDER_DEFINITIONS,
  DriveSyncError,
  sanitizeClientErrorMessage,
  assertNoSecretsInBackendPayload,
  serializeCanonicalJson,
  utf8ToBytes,
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  sha256BytesSync,
  computeSha256Hex,
  generatePkceChallengePair,
  buildNativeGoogleRedirectUri,
  createMobileAttendanceDriveSyncCore,
  formatDriveBackupTimestamp,
  deriveDriveBackupUiModel,
  type BackupArtifactType,
  type DriveOAuthConfigStatus,
  type DriveFoldersMetadata,
  type SecureTokenStoreAdapter,
  type MobileDriveSyncClientOptions,
  type DriveBackupUiModelInput,
} from './attendance-drive-sync-core.ts';

export {
  DRIVE_FILE_SCOPE,
  DRIVE_API_BASE,
  DRIVE_UPLOAD_BASE,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  FOLDER_MIME_TYPE,
  XLSX_MIME_TYPE,
  DEFAULT_ROOT_FOLDER_NAME,
  SECURE_STORE_REFRESH_TOKEN_KEY,
  SUBFOLDER_DEFINITIONS,
  DriveSyncError,
  sanitizeClientErrorMessage,
  assertNoSecretsInBackendPayload,
  serializeCanonicalJson,
  utf8ToBytes,
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  sha256BytesSync,
  computeSha256Hex,
  generatePkceChallengePair,
  buildNativeGoogleRedirectUri,
  createMobileAttendanceDriveSyncCore,
  formatDriveBackupTimestamp,
  deriveDriveBackupUiModel,
  type BackupArtifactType,
  type DriveOAuthConfigStatus,
  type DriveFoldersMetadata,
  type SecureTokenStoreAdapter,
  type MobileDriveSyncClientOptions,
  type DriveBackupUiModelInput,
};

if (typeof (WebBrowser as any)?.maybeCompleteAuthSession === 'function') {
  try {
    (WebBrowser as any).maybeCompleteAuthSession();
  } catch {}
}

export function createMobileAttendanceDriveSyncClient(options: MobileDriveSyncClientOptions = {}) {
  const defaultPlatform: 'ios' | 'android' | 'web' =
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

  return createMobileAttendanceDriveSyncCore({
    platform: options.platform || defaultPlatform,
    extraConfig: options.extraConfig ?? ((Constants.expoConfig?.extra as any) || {}),
    appScheme: options.appScheme || (Constants.expoConfig?.scheme as string) || 'semesterlibrary',
    backendFetch: options.backendFetch || apiFetch,
    driveFetch: options.driveFetch || fetch,
    openAuthSessionAsync:
      options.openAuthSessionAsync ||
      ((authUrl: string, redirectUri: string) => WebBrowser.openAuthSessionAsync(authUrl, redirectUri)),
    secureStore: options.secureStore || SecureStore,
    ...options,
  });
}

export const mobileAttendanceDriveSync = createMobileAttendanceDriveSyncClient();
