'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('MOBILE ADMIN DUAL-MODE SWITCHING SUITE', async (t) => {
  const repoRoot = path.resolve(__dirname, '..');
  const adminModeContextPath = path.join(repoRoot, 'mobile', 'context', 'AdminModeContext.tsx');
  const rootLayoutPath = path.join(repoRoot, 'mobile', 'app', '_layout.tsx');
  const tabLayoutPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', '_layout.tsx');
  const floatingBarPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'FloatingTabBar.tsx');
  const indexPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'index.tsx');
  const libraryPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'library.tsx');
  const chatPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const gamesPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'games.tsx');
  const profilePath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'profile.tsx');
  const adminProfilePath = path.join(repoRoot, 'mobile', 'components', 'admin', 'AdminProfileView.tsx');
  const adminDashboardPath = path.join(repoRoot, 'mobile', 'components', 'admin', 'AdminDashboardView.tsx');
  const profileViewPath = path.join(repoRoot, 'mobile', 'components', 'ProfileView.tsx');

  const adminModeContextContent = fs.readFileSync(adminModeContextPath, 'utf8');
  const rootLayoutContent = fs.readFileSync(rootLayoutPath, 'utf8');
  const tabLayoutContent = fs.readFileSync(tabLayoutPath, 'utf8');
  const floatingBarContent = fs.readFileSync(floatingBarPath, 'utf8');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  const libraryContent = fs.readFileSync(libraryPath, 'utf8');
  const chatContent = fs.readFileSync(chatPath, 'utf8');
  const gamesContent = fs.readFileSync(gamesPath, 'utf8');
  const profileContent = fs.readFileSync(profilePath, 'utf8');
  const adminProfileContent = fs.readFileSync(adminProfilePath, 'utf8');
  const adminDashboardContent = fs.readFileSync(adminDashboardPath, 'utf8');
  const profileViewContent = fs.readFileSync(profileViewPath, 'utf8');

  // 1. AdminModeContext definition & persistence
  await t.test('1. AdminModeContext exports AdminModeProvider, useAdminMode, and persists mode', () => {
    assert.ok(adminModeContextContent.includes('export function AdminModeProvider'), 'Provides AdminModeProvider');
    assert.ok(adminModeContextContent.includes('export function useAdminMode'), 'Provides useAdminMode hook');
    assert.ok(adminModeContextContent.includes('@semester_library_admin_view_mode'), 'Uses persistent storage key');
    assert.ok(adminModeContextContent.includes("isInAdminMode = isAdmin && adminMode === 'admin'"), 'Computes isInAdminMode strictly');
    assert.ok(adminModeContextContent.includes('toggleAdminMode'), 'Exposes toggleAdminMode handler');
  });

  // 2. Root layout mounting
  await t.test('2. Root layout mounts AdminModeProvider inside AuthProvider', () => {
    assert.ok(rootLayoutContent.includes("import { AdminModeProvider } from '@/context/AdminModeContext'"), 'Imports AdminModeProvider');
    assert.ok(rootLayoutContent.includes('<AdminModeProvider>'), 'Wraps application in AdminModeProvider');
  });

  // 3. Tab layout dynamic labels based on isInAdminMode
  await t.test('3. TabLayout options dynamically switch between Admin and Normal labels', () => {
    assert.ok(tabLayoutContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'TabLayout imports useAdminMode');
    assert.ok(tabLayoutContent.includes('const { isInAdminMode } = useAdminMode()'), 'Consumes isInAdminMode');
    assert.ok(
      tabLayoutContent.includes("title: isInAdminMode ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home'"),
      'Tab 0 title toggles between Dashboard and Home'
    );
    assert.ok(
      tabLayoutContent.includes("title: isInAdminMode ? 'Users' : isTeacher ? 'My Materials' : 'Library'"),
      'Tab 1 title toggles between Users and Library'
    );
    assert.ok(
      tabLayoutContent.includes("title: isInAdminMode ? 'Academics' : 'Chat'"),
      'Tab 2 title toggles between Academics and Chat'
    );
    assert.ok(
      tabLayoutContent.includes("title: isInAdminMode ? 'Content' : isTeacher ? 'Notices' : 'Games'"),
      'Tab 3 title toggles between Content and Games'
    );
  });

  // 4. FloatingTabBar configuration & quick toggle pill
  await t.test('4. FloatingTabBar toggles configs and renders floating switcher pill', () => {
    assert.ok(floatingBarContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'FloatingTabBar imports useAdminMode');
    assert.ok(
      floatingBarContent.includes("const { isAdmin, isInAdminMode, toggleAdminMode } = useAdminMode()"),
      'Consumes admin mode state and toggle handler'
    );
    assert.ok(
      floatingBarContent.includes("isInAdminMode\n      ? ADMIN_TAB_CONFIGS") ||
      floatingBarContent.includes("isInAdminMode ? ADMIN_TAB_CONFIGS"),
      'currentTabConfigs resolves ADMIN_TAB_CONFIGS when in admin mode'
    );
    assert.ok(floatingBarContent.includes('testID="admin-mode-toggle-pill"'), 'Renders floating mode toggle pill');
    assert.ok(floatingBarContent.includes('isInAdminMode ? \'Admin Mode\' : \'Normal Mode\''), 'Pill displays active mode label');
  });

  // 5. Index tab screen gating
  await t.test('5. Index tab switches between AdminDashboardView and StudentHomeScreenInner', () => {
    assert.ok(indexContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'Index imports useAdminMode');
    assert.ok(indexContent.includes('if (isInAdminMode) {'), 'Gates AdminDashboardView strictly on isInAdminMode');
    assert.ok(indexContent.includes('<StudentHomeScreenInner />'), 'Falls through to StudentHomeScreenInner in normal mode');
    assert.ok(indexContent.includes('setAdminMode(\'admin\')'), 'Provides header button to switch back to Admin Mode');
  });

  // 6. Library tab screen gating
  await t.test('6. Library tab switches between AdminUsersView and StudentLibraryView', () => {
    assert.ok(libraryContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'Library imports useAdminMode');
    assert.ok(libraryContent.includes('if (isInAdminMode) {'), 'Gates AdminUsersView strictly on isInAdminMode');
    assert.ok(libraryContent.includes('<StudentLibraryView />'), 'Falls through to student library view in normal mode');
  });

  // 7. Chat tab screen gating
  await t.test('7. Chat tab switches between AdminAcademicsView and ChatScreenInner', () => {
    assert.ok(
      chatContent.includes("from '@/context/AdminModeContext'") || chatContent.includes('from "@/context/AdminModeContext"'),
      'Chat imports useAdminMode'
    );
    assert.ok(chatContent.includes('if (isInAdminMode) {'), 'Gates AdminAcademicsView strictly on isInAdminMode');
    assert.ok(chatContent.includes('<ChatScreenInner />'), 'Falls through to ChatScreenInner in normal mode');
  });

  // 8. Games tab screen gating
  await t.test('8. Games tab switches between AdminContentView and GamesView', () => {
    assert.ok(gamesContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'Games imports useAdminMode');
    assert.ok(gamesContent.includes('if (isInAdminMode) {'), 'Gates AdminContentView strictly on isInAdminMode');
    assert.ok(gamesContent.includes('<GamesView />'), 'Falls through to GamesView in normal mode');
  });

  // 9. Profile tab screen gating
  await t.test('9. Profile tab switches between AdminProfileView and ProfileView', () => {
    assert.ok(profileContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'Profile imports useAdminMode');
    assert.ok(profileContent.includes('if (isInAdminMode) {'), 'Gates AdminProfileView strictly on isInAdminMode');
    assert.ok(profileContent.includes('<ProfileView isTab={true} />'), 'Falls through to ProfileView in normal mode');
  });

  // 10. AdminProfileView mode card
  await t.test('10. AdminProfileView provides Normal Mode switch action', () => {
    assert.ok(adminProfileContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'AdminProfileView imports useAdminMode');
    assert.ok(adminProfileContent.includes('testID="switch-to-normal-mode-btn"'), 'Renders button to switch to normal mode');
    assert.ok(adminProfileContent.includes("setAdminMode('normal')"), 'Calls setAdminMode normal');
  });

  // 11. AdminDashboardView header switcher
  await t.test('11. AdminDashboardView provides Normal View header switch action', () => {
    assert.ok(adminDashboardContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'AdminDashboardView imports useAdminMode');
    assert.ok(adminDashboardContent.includes('testID="dashboard-switch-to-normal-btn"'), 'Renders dashboard header normal view button');
    assert.ok(adminDashboardContent.includes("setAdminMode('normal')"), 'Calls setAdminMode normal from dashboard');
  });

  // 12. ProfileView normal mode card for admin accounts
  await t.test('12. ProfileView provides Admin Mode switch banner for administrator accounts', () => {
    assert.ok(profileViewContent.includes("import { useAdminMode } from '@/context/AdminModeContext'"), 'ProfileView imports useAdminMode');
    assert.ok(profileViewContent.includes('testID="profile-switch-to-admin-btn"'), 'Renders profile switch to admin mode button');
    assert.ok(profileViewContent.includes("setAdminMode('admin')"), 'Calls setAdminMode admin');
  });
});
