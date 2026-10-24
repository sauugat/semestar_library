# Google Drive Attendance Backup — OAuth Setup & End-to-End Verification Guide

This guide documents the exact Google Cloud Console setup, environment variables, and 9-step end-to-end verification procedure for Semester Library's teacher-owned Google Drive attendance backup system.

## 1. Security & Architecture Summary

- **Least-Privilege Scope:** Uses only `https://www.googleapis.com/auth/drive.file`, which grants access solely to folders and files created by Semester Library in the teacher's Google Drive.
- **Zero Backend Token Storage:** OAuth access tokens, refresh tokens, authorization codes, and client secrets are **never** sent to or stored by the Semester Library backend (`assertNoForbiddenSecrets` / `assertNoSecretsInBackendPayload`).
- **Web Token Lifecycle:** Browser access tokens are acquired via Google Identity Services (`https://accounts.google.com/gsi/client`) and held strictly in JavaScript closure memory (`inMemoryToken`), never in `localStorage`, `sessionStorage`, or cookies.
- **Mobile Token Lifecycle:** iOS and Android use OAuth 2.0 Authorization Code with PKCE (`S256`) via `expo-web-browser` (`WebBrowser.openAuthSessionAsync`). Short-lived access tokens stay in memory; refresh tokens (when issued by Google) are stored exclusively in hardware-backed `expo-secure-store` (`semester_library_teacher_drive_refresh_token_v1`).
- **Safe Unconfigured Fallback:** When OAuth Client IDs are unset or left as `YOUR_*` placeholders, the backend and clients report `NOT CONFIGURED` and all classroom attendance marking, 24-hour teacher edits, post-24h admin corrections, and student summaries operate normally.

## 2. Google Cloud Console Setup

### Step 2.1 — Enable the Google Drive API
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project (for example, `semester-libarary` referenced in `mobile/google-services.json`, or your dedicated Google Cloud project).
3. Navigate to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.

### Step 2.2 — Configure the OAuth Consent Screen
1. Navigate to **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Overview / Audience / Data Access**).
2. Configure **User Type**:
   - Select **External** (for teachers using personal `@gmail.com` accounts or mixed institutional accounts) or **Internal** (if restricted strictly to a single Google Workspace domain).
   - While in **Testing** publishing status, add the Google email addresses of all faculty test accounts under **Test users**.
3. Under **Data Access / Scopes**, add the single non-sensitive/narrow scope:
   - `https://www.googleapis.com/auth/drive.file`

### Step 2.3 — Create the 3 OAuth 2.0 Client IDs
Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:

#### A. Web Application OAuth Client ID (`GOOGLE_DRIVE_WEB_CLIENT_ID`)
- **Application type:** `Web application`
- **Authorized JavaScript origins:**
  - `https://semestar-library.vercel.app`
  - `http://localhost:3000` (for local web development)
- **Authorized redirect URIs:**
  - Not required for the Google Identity Services browser token model (`google.accounts.oauth2.initTokenClient` uses popup/postMessage origin validation), or optionally `https://semestar-library.vercel.app` and `http://localhost:3000`.
- **Important:** Copy only the **Client ID** (`<prefix>.apps.googleusercontent.com`). Do **not** copy or configure the Client Secret anywhere in Semester Library.

#### B. iOS OAuth Client ID (`GOOGLE_DRIVE_IOS_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID`)
- **Application type:** `iOS`
- **Bundle ID:** `com.semesterlibrary.app` (matches `expo.ios.bundleIdentifier` in `mobile/app.json`)
- **Expected Native Redirect URI:**
  - For an iOS Client ID `<prefix>.apps.googleusercontent.com`, the mobile client automatically constructs Google's required reverse-client-ID redirect URI:
    `com.googleusercontent.apps.<prefix>:/oauthredirect`
  - Ensure the reversed client ID URL scheme (`com.googleusercontent.apps.<prefix>`) is registered in `CFBundleURLSchemes` (`ios/SemesterLibrary/Info.plist` or `mobile/app.json` before prebuild) when building the native iOS app.

#### C. Android OAuth Client ID (`GOOGLE_DRIVE_ANDROID_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID`)
- **Application type:** `Android`
- **Package name:** `com.semesterlibrary.app` (matches `expo.android.package` in `mobile/app.json` and `mobile/google-services.json`)
- **SHA-1 certificate fingerprint:**
  - For local debug builds: run `cd mobile/android && ./gradlew signingReport` (or `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`) and copy the `SHA1` fingerprint.
  - For EAS / production builds: copy the SHA-1 fingerprint from `eas credentials` or Google Play App Signing.
- **Expected Native Redirect URI:**
  - For an Android Client ID `<prefix>.apps.googleusercontent.com`, the mobile client automatically constructs:
    `com.googleusercontent.apps.<prefix>:/oauthredirect`

## 3. Environment Variables

Set the public Client IDs in `.env` (or Vercel Environment Variables) and `mobile/.env` (see `.env.example` and `mobile/.env.example`):

```sh
# Backend & Web (.env / Vercel)
GOOGLE_DRIVE_WEB_CLIENT_ID=<web-prefix>.apps.googleusercontent.com
GOOGLE_DRIVE_IOS_CLIENT_ID=<ios-prefix>.apps.googleusercontent.com
GOOGLE_DRIVE_ANDROID_CLIENT_ID=<android-prefix>.apps.googleusercontent.com

# Mobile Expo Client (mobile/.env / EAS)
EXPO_PUBLIC_GOOGLE_DRIVE_IOS_CLIENT_ID=<ios-prefix>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_DRIVE_ANDROID_CLIENT_ID=<android-prefix>.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_DRIVE_WEB_CLIENT_ID=<web-prefix>.apps.googleusercontent.com
```

## 4. End-to-End Real Google Account Verification Procedure

Once real Google Cloud OAuth Client IDs are configured:

1. **Open Attendance Backup:** Sign in as an assigned teacher (`role = 'teacher'`) on Web (`/teacher-dashboard.html?view=attendance`) or Mobile (`Classroom Attendance` screen) and verify the **Attendance Backup** card displays **Not Connected** (`NOT CONNECTED`) rather than `Not Configured`.
2. **Connect Google Account:** Click/tap **Connect Google Drive**, complete the Google consent prompt for `drive.file`, and verify the card transitions to **Connected** (`CONNECTED`) displaying the teacher's Google account email.
3. **Verify Folder Hierarchy in Google Drive:** Open Google Drive and confirm that `Semester Library Attendance Backups` was created at the root with three subfolders:
   - `Daily Attendance/`
   - `Full Attendance/`
   - `Immutable Snapshots/`
4. **Submit or Edit Attendance:** Mark all students in an assigned subject/cohort roster as `Present` or `Absent` and submit the session (and optionally perform a 24-hour teacher edit).
5. **Verify Queued Artifacts:** Confirm the **Attendance Backup** card increments `Pending Backups` and lists the new session revision (`v1` / `v2`) with `Snapshot`, `Daily XLSX`, and `Annual XLSX` statuses.
6. **Claim & Upload Artifacts:** Click/tap **Sync Now** and verify the worker claims the pending run and uploads the canonical JSON snapshot and `.xlsx` workbooks to Google Drive.
7. **Verify Backend Completion:** Confirm the card transitions to `Pending: 0`, increments `Backed Up`, updates `Last Synced`, and displays `"Everything is up to date."`
8. **Inspect Files in Google Drive:**
   - In `Immutable Snapshots/`, verify the revision-specific JSON file (`<Subject>_<Cohort>_Sem<N>_<Date>_<SessionId>_v<Rev>_<Sha12>.json`) matches the canonical `snapshotSha256`.
   - In `Daily Attendance/`, open `Attendance_Daily_<YYYY-MM-DD>.xlsx` and verify the `Daily Summary` and session detail worksheets.
   - In `Full Attendance/`, open `Attendance_Year_<YYYY>.xlsx` and verify `Session Overview`, `Subject Summaries`, `Subject-Cohort Matrix`, and `Audit & Revisions`.
9. **Verify Idempotency on Reconnect / Retry:** Click/tap **Sync Now** again, or click **Disconnect Google Drive** followed by **Connect Google Drive** and **Sync Now**, and verify that existing folders and files are reused via `appProperties` (`slScopeKey`, `slArtifactSha256`, `slAggregateRevSum`) without creating duplicate folders, overwriting immutable snapshots, or downgrading multi-session workbooks.
