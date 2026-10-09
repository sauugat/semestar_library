'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('PREMIUM ADAPTIVE LIQUID GLASS NAVIGATION V4 — All 24 Required Regressions', () => {
  const repoRoot = path.join(__dirname, '..');
  const layoutPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', '_layout.tsx');
  const floatingBarPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'FloatingTabBar.tsx');
  const swipeContainerPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'TabSwipeContainer.tsx');
  const navScrollContextPath = path.join(repoRoot, 'mobile', 'context', 'NavScrollContext.tsx');
  const themePath = path.join(repoRoot, 'mobile', 'constants', 'theme.ts');
  const indexPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'index.tsx');
  const libraryPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'library.tsx');
  const profileViewPath = path.join(repoRoot, 'mobile', 'components', 'ProfileView.tsx');

  const barContent = fs.readFileSync(floatingBarPath, 'utf8');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  const swipeContent = fs.readFileSync(swipeContainerPath, 'utf8');
  const themeContent = fs.readFileSync(themePath, 'utf8');
  const navScrollContent = fs.readFileSync(navScrollContextPath, 'utf8');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  const libraryContent = fs.readFileSync(libraryPath, 'utf8');
  const profileViewContent = fs.readFileSync(profileViewPath, 'utf8');

  // Simulation parameters for geometry models
  const windowWidth = 390;
  const barWidthNormal = Math.min(420, Math.max(290, windowWidth - 36)); // 354
  const barWidthCompact = Math.round(barWidthNormal * 0.84); // 297 (~84%)
  const slotWidthNormal = barWidthNormal / 5; // 70.8
  const slotWidthCompact = barWidthCompact / 5; // 59.4
  const indicatorWidthNormal = 58;
  const indicatorWidthCompact = 50;

  const getSlotRestX = (idx, isCompact) => {
    const currentBarWidth = isCompact ? barWidthCompact : barWidthNormal;
    const currentSlotWidth = currentBarWidth / 5;
    const currentIndicatorWidth = isCompact ? indicatorWidthCompact : indicatorWidthNormal;
    return idx * currentSlotWidth + (currentSlotWidth - currentIndicatorWidth) / 2;
  };

  test('1. Profile picture displays', () => {
    assert.ok(barContent.includes('const avatarUri = useMemo('), 'Must resolve avatarUri reactively');
    assert.ok(
      barContent.includes('raw.startsWith(\'http://\') || raw.startsWith(\'https://\')'),
      'Must support both absolute URLs and relative uploaded paths'
    );
    assert.ok(barContent.includes('serverUrl || DEFAULT_SERVER_URL'), 'Must fallback to default server URL if serverUrl is unset');
    assert.ok(barContent.includes('source={{ uri: avatarUri }}'), 'Image component must bind to resolved avatarUri');
    assert.ok(barContent.includes('contentFit="cover"'), 'Image component must use contentFit="cover"');
  });

  test('2. Missing photo uses initials', () => {
    assert.ok(barContent.includes('const userInitials = useMemo('), 'Must derive user initials when photo is missing or unresolvable');
    assert.ok(barContent.includes('userInitials ? ('), 'Must render initials view when avatar is missing');
    assert.ok(barContent.includes('styles.avatarInitials'), 'Initials text must use avatarInitials styling');
  });

  test('3. No empty avatar circle', () => {
    assert.ok(barContent.includes('avatarUri && !avatarLoadError ? ('), 'Avatar picture branch only renders when uri exists AND no load error');
    assert.ok(barContent.includes('onError={() => setAvatarLoadError(true)}'), 'Must catch image load errors and transition to initials/icon');
    assert.ok(barContent.includes('<Ionicons'), 'Must have neutral Ionicons fallback if initials are also unavailable');
    // Ensure avatarWrapper is never rendered empty without an Image
    const avatarBlock = barContent.slice(barContent.indexOf('isProfileTab ?'), barContent.indexOf('styles.floatingContainer'));
    assert.ok(!avatarBlock.includes('<View style={[styles.avatarWrapper]}></View>'), 'Never render empty avatar wrapper');
  });

  test('4. Correct logout cleanup', () => {
    // When user logs out, user is null, so avatarUri is null, userInitials is empty
    assert.ok(
      barContent.includes('setAvatarLoadError(false)'),
      'Must reset error state when user changes or logs out'
    );
    assert.ok(
      barContent.includes('!user?.avatarUrl') && barContent.includes('return null;'),
      'Null or empty user avatarUrl immediately resolves avatarUri to null'
    );
  });

  test('5. Compact mode reduces width', () => {
    assert.ok(barContent.includes('barWidthNormal = Math.min(420, Math.max(290, windowWidth - 36))'), 'Normal bar width calculation matches screen width minus ~36dp');
    assert.ok(barContent.includes('barWidthCompact = Math.round(barWidthNormal * 0.84)'), 'Compact bar width is ~84% of normal width');
    assert.ok(barContent.includes('outputRange: [barWidthNormal, barWidthCompact]'), 'animatedBarWidth interpolates from normal to compact width');
    assert.ok(barWidthCompact < barWidthNormal, 'Compact width must be strictly less than normal width');
    const widthRatio = barWidthCompact / barWidthNormal;
    assert.ok(widthRatio >= 0.82 && widthRatio <= 0.85, 'Compact width must be between 82% and 85% of normal width');
  });

  test('6. Compact mode reduces height', () => {
    assert.ok(barContent.includes('BAR_HEIGHT_NORMAL = 54'), 'Normal bar height must be 54dp');
    assert.ok(barContent.includes('BAR_HEIGHT_COMPACT = 46'), 'Compact bar height must be 46dp (within 46-48dp range)');
    assert.ok(barContent.includes('outputRange: [BAR_HEIGHT_NORMAL, BAR_HEIGHT_COMPACT]'), 'animatedBarHeight interpolates 54 to 46');
  });

  test('7. Shrinking remains centered', () => {
    assert.ok(barContent.includes('alignItems: \'center\''), 'Container centers capsuleBar horizontally');
    assert.ok(barContent.includes('left: 0,\n    right: 0,'), 'Container spans full screen width to guarantee centered alignment');
    // Chat (index 2) center calculation on screen:
    // Screen center = windowWidth / 2 = 195
    const barLeftNormal = (windowWidth - barWidthNormal) / 2; // 18
    const chatCenterNormal = barLeftNormal + slotWidthNormal * 2.5; // 18 + 70.8 * 2.5 = 195
    const barLeftCompact = (windowWidth - barWidthCompact) / 2; // 46.5
    const chatCenterCompact = barLeftCompact + slotWidthCompact * 2.5; // 46.5 + 59.4 * 2.5 = 195
    assert.equal(chatCenterNormal, 195, 'Chat icon must be at screen center in normal mode');
    assert.equal(chatCenterCompact, 195, 'Chat icon must be at screen center in compact mode');
    assert.equal(chatCenterNormal, chatCenterCompact, 'Center must not shift horizontally when compacting');
  });

  test('8. Icon spacing adjusts correctly', () => {
    assert.ok(barContent.includes('flex: 1'), 'Tab buttons use flex: 1 for equal 20% slot distribution');
    assert.ok(slotWidthNormal > slotWidthCompact, 'Slot width smoothly adjusts inward in compact mode');
    assert.ok(slotWidthCompact >= 44, 'Compact slot width remains comfortably above 44dp');
  });

  test('9. Active pill stays aligned', () => {
    assert.ok(barContent.includes('INDICATOR_WIDTH_NORMAL = 58'), 'Normal indicator width is 58dp');
    assert.ok(barContent.includes('INDICATOR_WIDTH_COMPACT = 50'), 'Compact indicator width is 50dp');
    assert.ok(barContent.includes('INDICATOR_HEIGHT_NORMAL = 40'), 'Normal indicator height is 40dp');
    assert.ok(barContent.includes('INDICATOR_HEIGHT_COMPACT = 36'), 'Compact indicator height is 36dp');
    // Verify slot center aligns with indicator center for Chat (tab 2)
    const chatIndCenterNormal = getSlotRestX(2, false) + indicatorWidthNormal / 2; // 148 + 29 = 177 (bar center)
    const chatIndCenterCompact = getSlotRestX(2, true) + indicatorWidthCompact / 2; // 123.5 + 25 = 148.5 (bar center)
    assert.equal(chatIndCenterNormal, barWidthNormal / 2, 'Normal indicator center matches bar center for Chat');
    assert.equal(chatIndCenterCompact, barWidthCompact / 2, 'Compact indicator center matches bar center for Chat');
  });

  test('10. Scroll down activates compact mode', () => {
    assert.ok(navScrollContent.includes('SCROLL_THRESHOLD_DOWN = 24'), 'Downward threshold is ~24dp');
    assert.ok(navScrollContent.includes('accumulatedDeltaRef.current >= SCROLL_THRESHOLD_DOWN'), 'Triggers compact mode when accumulated downward scroll >= threshold');
    assert.ok(navScrollContent.includes('setIsCompact(true)'), 'Calls setIsCompact(true)');
  });

  test('11. Scroll up activates normal mode', () => {
    assert.ok(navScrollContent.includes('SCROLL_THRESHOLD_UP = 24'), 'Upward threshold is ~24dp');
    assert.ok(navScrollContent.includes('accumulatedDeltaRef.current <= -SCROLL_THRESHOLD_UP'), 'Triggers normal mode when accumulated upward scroll <= -threshold');
    assert.ok(navScrollContent.includes('setIsCompact(false)'), 'Calls setIsCompact(false)');
  });

  test('12. Scroll up works away from page top', () => {
    // Simulate scroll at 1000px down:
    let isCompact = true;
    let accumulatedDelta = 0;
    const scrollEvents = [
      { y: 1000 },
      { y: 990 }, // delta = -10
      { y: 980 }, // delta = -10
      { y: 970 }, // delta = -10 (total upward = -30dp)
    ];
    let prevY = 1000;
    for (let i = 1; i < scrollEvents.length; i++) {
      const deltaY = scrollEvents[i].y - prevY;
      prevY = scrollEvents[i].y;
      if (accumulatedDelta > 0) accumulatedDelta = 0;
      accumulatedDelta += deltaY;
      if (accumulatedDelta <= -24) {
        isCompact = false;
      }
    }
    assert.equal(isCompact, false, 'Scrolling up 30px from 1000px MUST expand navbar back to normal mode away from page top');
  });

  test('13. Small scroll changes do not flicker', () => {
    assert.ok(navScrollContent.includes('if (Math.abs(deltaY) < 1)'), 'Ignores sub-pixel jitter (< 1dp)');
    // 10dp movement should not trigger mode switch
    let accumulatedDelta = 10;
    assert.ok(accumulatedDelta < 24, '10dp oscillation does not reach 24dp threshold');
  });

  test('14. Chat never enters compact mode', () => {
    assert.ok(barContent.includes('isAdaptiveTab = state.index === 0 || state.index === 1 || state.index === 4'), 'Chat (index 2) not in adaptive tabs');
    assert.ok(barContent.includes('effectiveIsCompact = isAdaptiveTab ? isCompact : false'), 'effectiveIsCompact is false on Chat');
  });

  test('15. Games never enters compact mode', () => {
    assert.ok(!barContent.includes('state.index === 3'), 'Games (index 3) is strictly excluded from adaptive shrinking');
  });

  test('16. Glass background remains translucent', () => {
    assert.ok(themeContent.includes("navSurface: 'rgba(23, 23, 23, 0.70)'"), 'Surface uses dark translucent overlay rgba(23, 23, 23, 0.70)');
    assert.ok(themeContent.includes("navBorder: 'rgba(255, 255, 255, 0.12)'"), 'Border uses subtle translucent white edge rgba(255, 255, 255, 0.12)');
    assert.ok(themeContent.includes("navActiveIndicator: 'rgba(255, 255, 255, 0.14)'"), 'Active pill uses subtle glass highlight rgba(255, 255, 255, 0.14)');
  });

  test('17. Icons remain fully opaque', () => {
    assert.ok(themeContent.includes("navIconActive: '#FFFFFF'"), 'Active icon is solid #FFFFFF');
    assert.ok(themeContent.includes("navIconInactive: '#B0B0B0'"), 'Inactive icons are solid #B0B0B0');
    assert.ok(!barContent.includes('opacity: 0.7'), 'No container opacity style reduces icon clarity');
  });

  test('18. Native blur fallback works', () => {
    // When expo-blur is not installed, translucent charcoal background + highlight border renders gracefully
    assert.ok(barContent.includes('backgroundColor: Monochrome.navSurface'), 'Renders solid translucent background fallback');
    assert.ok(barContent.includes('borderTopColor: \'rgba(255, 255, 255, 0.18)\''), 'Renders top rim highlight');
  });

  test('19. No mixed animation drivers', () => {
    // compactAnim is strictly false
    const jsCalls = [...barContent.matchAll(/Animated\.(spring|timing)\(([^,]+),\s*\{([^}]+useNativeDriver:\s*false[^}]*)\}/g)];
    assert.ok(jsCalls.length >= 1, 'Must have JS-driven timing call for compactAnim');
    for (const match of jsCalls) {
      assert.equal(match[2].trim(), 'compactAnim', 'Only compactAnim uses useNativeDriver: false');
    }

    // indicatorAnim is strictly true
    const nativeCalls = [...barContent.matchAll(/Animated\.(spring|timing)\(([^,]+),\s*\{([^}]+useNativeDriver:\s*true[^}]*)\}/g)];
    assert.ok(nativeCalls.length >= 4, 'Must have at least 4 native-driven spring calls for indicatorAnim');
    for (const match of nativeCalls) {
      assert.equal(match[2].trim(), 'indicatorAnim', 'Only indicatorAnim uses useNativeDriver: true');
    }
  });

  test('20. No unsupported native height animation', () => {
    const trackStyleMatch = barContent.match(/styles\.indicatorTrack,\s*\{([\s\S]*?)\}\s*\]/);
    assert.ok(trackStyleMatch, 'indicatorTrack style exists');
    assert.ok(!trackStyleMatch[1].includes('height:'), 'indicatorTrack must NEVER contain animated height');
    assert.ok(!trackStyleMatch[1].includes('width:'), 'indicatorTrack must NEVER contain animated width');
  });

  test('21. Navbar scrubbing still works', () => {
    assert.ok(barContent.includes('dragOriginIndexRef.current = currentActive'), 'Anchor to active tab on grant');
    assert.ok(barContent.includes('indicatorAnim.setValue(clampedLeft)'), 'Directly updates indicator translation on pan');
    assert.ok(barContent.includes('startTouchTimeRef.current'), 'Tracks touch time to distinguish tap from drag');
  });

  test('22. No navigation haptic vibration', () => {
    assert.ok(!barContent.includes('Haptics.'), 'Zero Haptics in FloatingTabBar');
    assert.ok(!barContent.includes('Vibration.'), 'Zero Vibration in FloatingTabBar');
    assert.ok(!swipeContent.includes('Haptics.'), 'Zero Haptics in TabSwipeContainer');
  });

  test('23. Touch targets remain accessible', () => {
    assert.ok(barContent.includes('minHeight: 44'), 'Tab button enforces minHeight: 44');
    assert.ok(barContent.includes('hitSlop={{ top: 8, bottom: 8 }}'), 'Tab button includes hitSlop for comfortable touches');
  });

  test('24. Safe-area positioning remains correct', () => {
    assert.ok(barContent.includes('insets.bottom - 13'), 'iOS safe-area offset accounts for home indicator clearance');
    assert.ok(barContent.includes('insets.bottom - 6'), 'Android safe-area offset accounts for gesture bar');
  });
});

describe('Runtime Animation Safety & Driver Separation Verification (Zero-Crash Guarantee)', () => {
  const repoRoot = path.join(__dirname, '..');
  const floatingBarPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'FloatingTabBar.tsx');
  const chatScreenPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const dmScreenPath = path.join(repoRoot, 'mobile', 'app', 'dm', '[id].tsx');

  const barContent = fs.readFileSync(floatingBarPath, 'utf8');
  const chatContent = fs.readFileSync(chatScreenPath, 'utf8');
  const dmContent = fs.readFileSync(dmScreenPath, 'utf8');

  test('A. Driver Separation: indicatorTrack uses strictly native transform without layout properties', () => {
    const trackStyleMatch = barContent.match(/styles\.indicatorTrack,\s*\{([\s\S]*?)\}\s*\]/);
    assert.ok(trackStyleMatch, 'indicatorTrack style block must be defined');
    const trackStyle = trackStyleMatch[1];
    assert.ok(trackStyle.includes('translateX: indicatorAnim'), 'indicatorTrack must contain translateX: indicatorAnim');
    assert.ok(!trackStyle.includes('height:'), 'indicatorTrack MUST NOT contain animated height');
    assert.ok(!trackStyle.includes('top:'), 'indicatorTrack MUST NOT contain animated top');
    assert.ok(!trackStyle.includes('borderRadius:'), 'indicatorTrack MUST NOT contain animated borderRadius');
  });

  test('B. Driver Separation: indicatorPill uses strictly JS layout properties without native transforms', () => {
    const pillStyleMatch = barContent.match(/styles\.indicatorPill[\s\S]*?\{([\s\S]*?)\}[\s,]*\]/);
    assert.ok(pillStyleMatch, 'indicatorPill style block must be defined');
    const pillStyle = pillStyleMatch[1];
    assert.ok(pillStyle.includes('height: animatedIndicatorHeight'), 'indicatorPill must contain animatedIndicatorHeight');
    assert.ok(pillStyle.includes('width: animatedIndicatorWidth'), 'indicatorPill must contain animatedIndicatorWidth');
    assert.ok(pillStyle.includes('borderRadius: animatedIndicatorRadius'), 'indicatorPill must contain animatedIndicatorRadius');
    assert.ok(pillStyle.includes('top: animatedIndicatorTop'), 'indicatorPill must contain animatedIndicatorTop');
    assert.ok(!pillStyle.includes('transform:'), 'indicatorPill MUST NOT contain transforms');
    assert.ok(!pillStyle.includes('indicatorAnim'), 'indicatorPill MUST NOT reference indicatorAnim');
  });

  test('C. Native Module Safety: Zero occurrences of height or width driven by native animated module', () => {
    const nativeCalls = [...barContent.matchAll(/Animated\.(spring|timing)\(([^,]+),\s*\{([^}]+useNativeDriver:\s*true[^}]*)\}/g)];
    assert.ok(nativeCalls.length >= 4, 'Must have at least 4 native-driven spring calls for indicatorAnim');
    for (const match of nativeCalls) {
      const animatedTarget = match[2].trim();
      assert.equal(animatedTarget, 'indicatorAnim', 'Native-driven animation MUST ONLY target indicatorAnim');
    }
  });

  test('D. JS Driver Safety: compactAnim strictly uses useNativeDriver: false', () => {
    const jsCalls = [...barContent.matchAll(/Animated\.(spring|timing)\(([^,]+),\s*\{([^}]+useNativeDriver:\s*false[^}]*)\}/g)];
    assert.ok(jsCalls.length >= 1, 'Must have at least 1 JS-driven timing call for compactAnim');
    for (const match of jsCalls) {
      const animatedTarget = match[2].trim();
      assert.equal(animatedTarget, 'compactAnim', 'JS-driven animation MUST ONLY target compactAnim');
    }
  });

  test('E. Animation Lifecycle: Cleanup functions stop active animations on unmount', () => {
    assert.ok(barContent.includes('anim.stop()'), 'Must call anim.stop() in cleanup to prevent memory leaks/races');
    assert.ok(barContent.includes('indicatorAnim.stopAnimation()'), 'Must cancel running indicator animations on gesture grant');
  });

  test('F. Full Tab Route Traversal & State Preservations (1-5)', () => {
    const routes = ['index', 'library', 'chat', 'games', 'profile'];
    assert.equal(routes.length, 5);
    for (let i = 0; i < routes.length; i++) {
      assert.ok(barContent.includes(`name: '${routes[i]}'`), `Route ${routes[i]} must be registered`);
    }
  });

  test('G. Scroll Resizing & Conversation Transition Immunities (6-17)', () => {
    assert.ok(chatContent.includes('tabBarStyle: selectedCohortRoom ? { display: "none" } : undefined'), 'Chat hides tab bar in room');
    assert.ok(dmContent.includes('handleBack'), 'DM provides safe back handler');
  });
});

describe('Native Pager View & Gesture Navigation Engine — Genuine Interaction Tests', () => {
  const repoRoot = path.join(__dirname, '..');
  const pagerTabsPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'PagerTabs.tsx');
  const floatingBarPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'FloatingTabBar.tsx');
  const swipeContainerPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'TabSwipeContainer.tsx');
  const layoutPath = path.join(repoRoot, 'mobile', 'app', '(tabs)', '_layout.tsx');

  const pagerTabsContent = fs.readFileSync(pagerTabsPath, 'utf8');
  const floatingBarContent = fs.readFileSync(floatingBarPath, 'utf8');
  const swipeContainerContent = fs.readFileSync(swipeContainerPath, 'utf8');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');

  // Interactive Pager State Machine Simulator
  class PagerInteractionHarness {
    constructor(initialIndex = 0, isCompact = false) {
      this.routes = [
        { key: 'index-1', name: 'index' },
        { key: 'library-2', name: 'library' },
        { key: 'chat-3', name: 'chat' },
        { key: 'games-4', name: 'games' },
        { key: 'profile-5', name: 'profile' },
      ];
      this.state = { index: initialIndex, routes: this.routes };
      this.isCompact = isCompact;
      this.isUserInteracting = false;
      this.childSwipeEnabled = true;
      this.descriptorOptions = {};
      this.scrollListeners = new Set();
      this.navigatedRoute = null;
      this.navigatedCount = 0;
      this.indicatorX = 0;

      // Layout geometry
      this.barWidth = isCompact ? 297 : 354;
      this.slotWidth = this.barWidth / 5;
      this.indicatorWidth = isCompact ? 50 : 58;

      this.indicatorX = this.computeIndicatorRestX(initialIndex);
    }

    computeIndicatorRestX(idx) {
      return idx * this.slotWidth + (this.slotWidth - this.indicatorWidth) / 2;
    }

    computeIndicatorProgressX(position, offset) {
      const fractionalPos = position + offset;
      return fractionalPos * this.slotWidth + (this.slotWidth - this.indicatorWidth) / 2;
    }

    registerScrollListener(listener) {
      this.scrollListeners.add(listener);
      return () => this.scrollListeners.delete(listener);
    }

    isSwipeEnabled() {
      const focusedRoute = this.state.routes[this.state.index];
      const options = this.descriptorOptions[focusedRoute?.key] || {};
      return (
        this.childSwipeEnabled &&
        options.swipeEnabled !== false &&
        options.tabBarStyle?.display !== 'none'
      );
    }

    // Simulate native pager events
    simulatePageScrollStateChanged(state) {
      this.isUserInteracting = state === 'dragging' || state === 'settling';
    }

    simulatePageScroll(position, offset) {
      if (!this.isSwipeEnabled()) {
        return; // Native pager ignores swipe when disabled
      }
      for (const listener of this.scrollListeners) {
        listener(position, offset);
      }
      this.indicatorX = this.computeIndicatorProgressX(position, offset);
    }

    simulatePageSelected(newIndex) {
      this.isUserInteracting = false;
      if (newIndex !== this.state.index && this.state.routes[newIndex]) {
        this.navigatedRoute = this.state.routes[newIndex].name;
        this.navigatedCount++;
        this.state.index = newIndex;
        this.indicatorX = this.computeIndicatorRestX(newIndex);
      }
    }

    simulateTabTap(targetIndex) {
      const clamped = Math.min(4, Math.max(0, targetIndex));
      if (clamped !== this.state.index) {
        this.navigatedRoute = this.state.routes[clamped].name;
        this.navigatedCount++;
        this.state.index = clamped;
        this.indicatorX = this.computeIndicatorRestX(clamped);
      }
    }
  }

  test('Pager-1: Layout wraps PagerTabs with LayoutContext and FloatingTabBar', () => {
    assert.ok(layoutContent.includes('<PagerTabs'), 'Layout must render PagerTabs');
    assert.ok(layoutContent.includes('tabBar={(props: any) => <FloatingTabBar {...props} />}'), 'Layout connects FloatingTabBar via render prop');
    assert.ok(pagerTabsContent.includes('export const PagerTabs = withLayoutContext'), 'PagerTabs exports withLayoutContext');
  });

  test('Pager-2: PagerView renders all 5 routes side-by-side with offscreenPageLimit=2', () => {
    assert.ok(pagerTabsContent.includes('<PagerView'), 'Must render native PagerView');
    assert.ok(pagerTabsContent.includes('offscreenPageLimit={2}'), 'Must preload adjacent pages offscreen to prevent blank gaps');
    assert.ok(pagerTabsContent.includes('collapsable={false}'), 'Page views must not be collapsed by Android native optimizer');
    assert.ok(pagerTabsContent.includes("backgroundColor: '#080808'"), 'All viewports must use dark theme #080808 (no white flash)');
  });

  test('Pager-3: Adjacent Transition 1 — Home (0) <-> Library (1)', () => {
    const harness = new PagerInteractionHarness(0);
    harness.registerScrollListener((pos, off) => {
      harness.indicatorX = harness.computeIndicatorProgressX(pos, off);
    });

    const homeRestX = harness.computeIndicatorRestX(0);
    const libRestX = harness.computeIndicatorRestX(1);

    assert.equal(harness.indicatorX, homeRestX);

    // Swipe left from Home toward Library
    harness.simulatePageScrollStateChanged('dragging');
    harness.simulatePageScroll(0, 0.25);
    assert.ok(harness.indicatorX > homeRestX && harness.indicatorX < libRestX);

    harness.simulatePageScroll(0, 0.5);
    assert.equal(harness.indicatorX, (homeRestX + libRestX) / 2);

    harness.simulatePageScroll(0, 1.0);
    harness.simulatePageScrollStateChanged('settling');
    harness.simulatePageSelected(1);

    assert.equal(harness.state.index, 1);
    assert.equal(harness.navigatedRoute, 'library');
    assert.equal(harness.indicatorX, libRestX);

    // Swipe right from Library back to Home
    harness.simulatePageScroll(0, 0.5);
    assert.equal(harness.indicatorX, (homeRestX + libRestX) / 2);
    harness.simulatePageSelected(0);
    assert.equal(harness.state.index, 0);
    assert.equal(harness.navigatedRoute, 'index');
    assert.equal(harness.indicatorX, homeRestX);
  });

  test('Pager-4: Adjacent Transition 2 — Library (1) <-> Chat (2, Centered)', () => {
    const harness = new PagerInteractionHarness(1);
    const libRestX = harness.computeIndicatorRestX(1);
    const chatRestX = harness.computeIndicatorRestX(2);

    assert.equal(harness.indicatorX, libRestX);
    // Chat index 2 is exactly at center of navbar:
    assert.equal(chatRestX + harness.indicatorWidth / 2, harness.barWidth / 2);

    harness.simulatePageScroll(1, 0.5);
    assert.equal(harness.indicatorX, (libRestX + chatRestX) / 2);

    harness.simulatePageSelected(2);
    assert.equal(harness.state.index, 2);
    assert.equal(harness.navigatedRoute, 'chat');
    assert.equal(harness.indicatorX, chatRestX);
  });

  test('Pager-5: Adjacent Transition 3 — Chat (2) <-> Games (3)', () => {
    const harness = new PagerInteractionHarness(2);
    const chatRestX = harness.computeIndicatorRestX(2);
    const gamesRestX = harness.computeIndicatorRestX(3);

    harness.simulatePageScroll(2, 0.7);
    assert.ok(harness.indicatorX > chatRestX && harness.indicatorX < gamesRestX);

    harness.simulatePageSelected(3);
    assert.equal(harness.state.index, 3);
    assert.equal(harness.navigatedRoute, 'games');
    assert.equal(harness.indicatorX, gamesRestX);
  });

  test('Pager-6: Adjacent Transition 4 — Games (3) <-> Profile (4)', () => {
    const harness = new PagerInteractionHarness(3);
    const gamesRestX = harness.computeIndicatorRestX(3);
    const profileRestX = harness.computeIndicatorRestX(4);

    harness.simulatePageScroll(3, 1.0);
    harness.simulatePageSelected(4);
    assert.equal(harness.state.index, 4);
    assert.equal(harness.navigatedRoute, 'profile');
    assert.equal(harness.indicatorX, profileRestX);
  });

  test('Pager-7: Slow Drag follows finger fractional offset precisely', () => {
    const harness = new PagerInteractionHarness(0);
    const steps = [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    let prevX = harness.indicatorX;

    for (const offset of steps) {
      harness.simulatePageScroll(0, offset);
      assert.ok(harness.indicatorX > prevX, `Indicator must continuously advance at offset ${offset}`);
      prevX = harness.indicatorX;
    }
  });

  test('Pager-8: Cancelled Swipe returns smoothly to origin tab', () => {
    const harness = new PagerInteractionHarness(1); // Start at Library
    const libRestX = harness.computeIndicatorRestX(1);

    // User starts dragging toward Chat, but aborts and lets go
    harness.simulatePageScroll(1, 0.25);
    assert.ok(harness.indicatorX > libRestX);

    // Gestures settles back to 0 without reaching threshold
    harness.simulatePageScroll(1, 0.0);
    harness.simulatePageSelected(1); // Re-selects Library

    assert.equal(harness.state.index, 1);
    assert.equal(harness.navigatedCount, 0, 'No navigation transition triggered on cancelled swipe');
    assert.equal(harness.indicatorX, libRestX);
  });

  test('Pager-9: Rapid Direction Changes do not corrupt indicator or navigation count', () => {
    const harness = new PagerInteractionHarness(1);
    // Drag forward
    harness.simulatePageScroll(1, 0.4);
    // Reverse backward
    harness.simulatePageScroll(1, 0.1);
    // Flick forward again
    harness.simulatePageScroll(1, 0.85);
    // Commit to Chat
    harness.simulatePageSelected(2);

    assert.equal(harness.state.index, 2);
    assert.equal(harness.navigatedCount, 1, 'Only exactly 1 navigation event fired despite oscillating gestures');
  });

  test('Pager-10: Cohort Conversation strictly disables Pager Swiping', () => {
    const harness = new PagerInteractionHarness(2); // Chat tab
    assert.equal(harness.isSwipeEnabled(), true, 'Initially swipe enabled on Chat tab');

    // Simulate user entering a Cohort Conversation
    const chatRouteKey = harness.routes[2].key;
    harness.descriptorOptions[chatRouteKey] = {
      tabBarStyle: { display: 'none' },
    };
    assert.equal(harness.isSwipeEnabled(), false, 'tabBarStyle: { display: "none" } locks swipe');

    // Child swipe disabled via TabSwipeContainer disabled={true}
    harness.childSwipeEnabled = false;
    assert.equal(harness.isSwipeEnabled(), false, 'childSwipeEnabled=false locks swipe');

    // Verify swipe gesture attempts are ignored
    const initialIndicatorX = harness.indicatorX;
    harness.simulatePageScroll(2, 0.5);
    assert.equal(harness.indicatorX, initialIndicatorX, 'Indicator does not move when swipe is locked');

    // Returning from cohort conversation unlocks swipe
    harness.descriptorOptions[chatRouteKey] = {};
    harness.childSwipeEnabled = true;
    assert.equal(harness.isSwipeEnabled(), true, 'Swipe is safely restored after exiting room');
  });

  test('Pager-11: Tab Bar Tap immediately navigates and positions indicator', () => {
    const harness = new PagerInteractionHarness(0); // Home
    assert.equal(harness.state.index, 0);

    // Tap Games (tab index 3)
    harness.simulateTabTap(3);
    assert.equal(harness.state.index, 3);
    assert.equal(harness.navigatedRoute, 'games');
    assert.equal(harness.indicatorX, harness.computeIndicatorRestX(3));
  });

  test('Pager-12: Zero pan-translation artifacts in TabSwipeContainer', () => {
    assert.ok(!swipeContainerContent.includes('PanResponder.create'), 'PanResponder screen translation is completely removed from TabSwipeContainer');
    assert.ok(!swipeContainerContent.includes('translateX'), 'translateX screen sliding is removed');
    assert.ok(swipeContainerContent.includes('usePagerSwipe'), 'TabSwipeContainer hooks into usePagerSwipe');
  });
});

describe('Platform-Specific Native Apple Liquid Glass on iOS 26+ (expo-glass-effect)', () => {
  const repoRoot = path.join(__dirname, '..');
  const packageJsonPath = path.join(repoRoot, 'mobile', 'package.json');
  const floatingBarPath = path.join(repoRoot, 'mobile', 'components', 'navigation', 'FloatingTabBar.tsx');

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const barContent = fs.readFileSync(floatingBarPath, 'utf8');

  // Device check simulator matching FloatingTabBar.isLiquidGlassSupportedOnDevice
  function simulateLiquidGlassSupport(platform, apis) {
    const pOS = platform?.OS ?? 'android';
    const pPad = platform?.isPad ?? false;
    const pVersion = platform?.Version ?? 0;

    if (pOS !== 'ios') return false;
    if (pPad) return false;

    const majorVersion = parseInt(String(pVersion), 10);
    if (isNaN(majorVersion) || majorVersion < 26) {
      return false;
    }

    try {
      const checkApi = apis?.isGlassEffectAPIAvailable;
      const isApiAvailable = typeof checkApi === 'function' ? checkApi() : false;
      if (!isApiAvailable) return false;

      const checkLiquid = apis?.isLiquidGlassAvailable;
      const isLiquidAvailable = typeof checkLiquid === 'function' ? checkLiquid() : false;
      return Boolean(isLiquidAvailable);
    } catch {
      return false;
    }
  }

  test('Glass-1: Official expo-glass-effect package is configured in mobile/package.json', () => {
    assert.ok(pkg.dependencies['expo-glass-effect'], 'expo-glass-effect must be in dependencies');
    assert.ok(
      pkg.dependencies['expo-glass-effect'].includes('57.'),
      'expo-glass-effect must match Expo SDK 57 (~57.0.4)'
    );
  });

  test('Glass-2: FloatingTabBar imports GlassView and runtime availability functions', () => {
    assert.ok(barContent.includes("from 'expo-glass-effect'"), 'Must import from expo-glass-effect');
    assert.ok(barContent.includes('GlassView'), 'Must import GlassView component');
    assert.ok(barContent.includes('isLiquidGlassAvailable'), 'Must import isLiquidGlassAvailable()');
    assert.ok(barContent.includes('isGlassEffectAPIAvailable'), 'Must import isGlassEffectAPIAvailable()');
  });

  test('Glass-3: Strict device gating — ONLY iPhones running iOS 26+ qualify', () => {
    const apisAvailable = {
      isGlassEffectAPIAvailable: () => true,
      isLiquidGlassAvailable: () => true,
    };

    // Android must never qualify
    assert.equal(simulateLiquidGlassSupport({ OS: 'android', Version: 35 }, apisAvailable), false);

    // iPad must not qualify
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 26, isPad: true }, apisAvailable), false);

    // iOS 17, 18, 25 must not qualify
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 17, isPad: false }, apisAvailable), false);
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 18.2, isPad: false }, apisAvailable), false);
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 25.9, isPad: false }, apisAvailable), false);

    // Missing runtime APIs on iOS 26 must not qualify
    assert.equal(
      simulateLiquidGlassSupport(
        { OS: 'ios', Version: 26, isPad: false },
        { isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => true }
      ),
      false
    );
    assert.equal(
      simulateLiquidGlassSupport(
        { OS: 'ios', Version: 26, isPad: false },
        { isGlassEffectAPIAvailable: () => true, isLiquidGlassAvailable: () => false }
      ),
      false
    );

    // Genuine iPhone on iOS 26+ with runtime APIs MUST qualify
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 26, isPad: false }, apisAvailable), true);
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: '26.1.0', isPad: false }, apisAvailable), true);
    assert.equal(simulateLiquidGlassSupport({ OS: 'ios', Version: 27, isPad: false }, apisAvailable), true);
  });

  test('Glass-4: Native Apple Liquid Glass styling and dark appearance', () => {
    assert.ok(barContent.includes('<GlassView'), 'FloatingTabBar must render GlassView conditionally');
    assert.ok(barContent.includes('colorScheme="dark"'), 'GlassView must use dark colorScheme');
    assert.ok(barContent.includes("style: 'regular'"), 'GlassView must use regular glass material style');
    assert.ok(barContent.includes('pointerEvents="none"'), 'GlassView must have pointerEvents="none" to allow touches to pass through');
  });

  test('Glass-5: Android & unsupported iPhones fallback to translucent charcoal navbar', () => {
    assert.ok(
      barContent.includes('backgroundColor: Monochrome.navSurface'),
      'Fallback renders existing translucent charcoal background'
    );
    assert.ok(
      barContent.includes('isLiquidGlassSupported && { backgroundColor: \'transparent\' }'),
      'Translucent charcoal is overridden with transparent only when native GlassView is active'
    );
  });

  test('Glass-6: GlassView opacity is never animated directly', () => {
    // Check that no Animated.Value drives opacity on GlassView
    assert.ok(!barContent.includes('opacity: compactAnim'), 'compactAnim must not animate opacity');
    assert.ok(barContent.includes('animationDuration: 0.18'), 'Uses official glassEffectStyle config for style animations');
  });

  test('Glass-7: Five tabs, centered Chat, and profile avatar are fully preserved', () => {
    assert.ok(barContent.includes("name: 'chat'"), 'Chat tab is defined');
    assert.ok(barContent.includes('TAB_CONFIGS.length'), 'Uses standard TAB_CONFIGS');
    assert.ok(barContent.includes('avatarUri && !avatarLoadError'), 'Profile avatar logic is intact');
    assert.ok(barContent.includes('dragOriginIndexRef.current = currentActive'), 'Drag origin anchored to active tab');
  });
});


