'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Step 5B.2: Messaging Design System Foundation', () => {
  const repoRoot = path.join(__dirname, '..');
  const mobileConstantsDir = path.join(repoRoot, 'mobile', 'constants');
  const themePath = path.join(mobileConstantsDir, 'theme.ts');
  const motionPath = path.join(mobileConstantsDir, 'motion.ts');
  const geometryPath = path.join(mobileConstantsDir, 'messagingGeometry.ts');
  const dmCssPath = path.join(repoRoot, 'public', 'dm-chat.css');
  const dmServicePath = path.join(repoRoot, 'lib', 'dm-service.js');

  // 1. Mobile Semantic Color Tokens
  test('1. Mobile Semantic Color Tokens: theme.ts defines dark and light messaging tokens', () => {
    assert.ok(fs.existsSync(themePath), 'theme.ts must exist');
    const content = fs.readFileSync(themePath, 'utf8');

    const expectedTokens = [
      'bubbleOutgoingBg',
      'bubbleOutgoingText',
      'bubbleIncomingBg',
      'bubbleIncomingText',
      'bubbleIncomingBorder',
      'timestampText',
      'receiptSent',
      'receiptSeen',
      'unreadBadgeBg',
      'unreadBadgeText',
      'offlineBannerBg',
      'offlineBannerText',
      'blockedBannerBg',
      'blockedBannerText',
      'interactivePressed',
      'textDisabled',
    ];

    for (const token of expectedTokens) {
      assert.ok(content.includes(token), `theme.ts must define token: ${token}`);
    }

    // Baseline dark palette integrity
    assert.ok(content.includes("background: '#0a0a0a'") || content.includes('background: "#0a0a0a"'));
    assert.ok(content.includes("surface: '#141414'") || content.includes('surface: "#141414"'));
    assert.ok(content.includes("surfaceRaised: '#1c1c1c'") || content.includes('surfaceRaised: "#1c1c1c"'));
    assert.ok(content.includes("text: '#f5f5f5'") || content.includes('text: "#f5f5f5"'));
    assert.ok(content.includes("textSecondary: '#a3a3a3'") || content.includes('textSecondary: "#a3a3a3"'));
  });

  // 2. Mobile Typography System
  test('2. Mobile Typography System: defines semantic messaging type styles', () => {
    const content = fs.readFileSync(themePath, 'utf8');

    const expectedTypeStyles = [
      'pageTitle',
      'sectionHeading',
      'conversationTitle',
      'inboxUsername',
      'messageBody',
      'messagePreview',
      'timestamp',
      'roleMetadata',
      'inputText',
      'buttonLabel',
      'statusLabel',
    ];

    assert.ok(content.includes('MessagingTypography'), 'theme.ts must export MessagingTypography');
    for (const style of expectedTypeStyles) {
      assert.ok(content.includes(style), `MessagingTypography must include: ${style}`);
    }
  });

  // 3. Spacing and Geometry
  test('3. Spacing and Geometry: defines 8-point rhythm and >=48dp touch targets', () => {
    assert.ok(fs.existsSync(geometryPath), 'messagingGeometry.ts must exist');
    const content = fs.readFileSync(geometryPath, 'utf8');

    assert.ok(content.includes('MessagingGeometry'), 'messagingGeometry.ts must export MessagingGeometry');
    assert.ok(content.includes('minTouchTarget: 48'), 'Touch target must adhere to 48dp standard');
    assert.ok(content.includes('headerHeight: 56'), 'Header must have standard geometry');
    assert.ok(content.includes('inboxRowMinHeight: 72'), 'Inbox row must have min height');
    assert.ok(content.includes('bubbleMaxWidthPercent: 0.78'), 'Bubble max width percent must be defined');
    assert.ok(content.includes('bubbleConsecutiveMargin: 2'), 'Consecutive bubble margin must be 2dp');
    assert.ok(content.includes('bubbleGroupMargin: 8'), 'Group bubble margin must be 8dp');
  });

  // 4. Corner Radii
  test('4. Corner Radii: defines semantic messaging corner radii', () => {
    const content = fs.readFileSync(themePath, 'utf8');

    assert.ok(content.includes('MessagingRadii'), 'theme.ts must export MessagingRadii');
    assert.ok(content.includes('bubble: 16'), 'Default bubble radius must be 16');
    assert.ok(content.includes('bubbleConsecutive: 4'), 'Consecutive bubble corner must be 4');
    assert.ok(content.includes('sheet: 24'), 'Bottom sheet radius must be 24');
  });

  // 5. Motion Design Tokens
  test('5. Motion Design Tokens: defines durations, easings, and spring configurations', () => {
    assert.ok(fs.existsSync(motionPath), 'motion.ts must exist');
    const content = fs.readFileSync(motionPath, 'utf8');

    assert.ok(content.includes('fastFeedback: 90'), 'fastFeedback must be in 70-110ms range');
    assert.ok(content.includes('smallTransition: 120'), 'smallTransition must be in 100-150ms range');
    assert.ok(content.includes('elementEntrance: 150'), 'elementEntrance must be in 120-180ms range');
    assert.ok(content.includes('contextMenu: 180'), 'contextMenu must be in 160-220ms range');
    assert.ok(content.includes('navigation: 240'), 'navigation must be in 200-280ms range');

    assert.ok(content.includes('MotionEasing'), 'MotionEasing must be defined');
    assert.ok(content.includes('MotionSpring'), 'MotionSpring must be defined');
  });

  // 6. Website CSS Token Foundation
  test('6. Website CSS Token Foundation: dm-chat.css exposes :root semantic tokens', () => {
    assert.ok(fs.existsSync(dmCssPath), 'dm-chat.css must exist');
    const content = fs.readFileSync(dmCssPath, 'utf8');

    const expectedCssVars = [
      '--msg-bg',
      '--msg-bg-surface',
      '--msg-bg-surface-raised',
      '--msg-border',
      '--msg-text-primary',
      '--msg-text-secondary',
      '--msg-text-muted',
      '--msg-bubble-out-bg',
      '--msg-bubble-in-bg',
      '--msg-receipt-seen',
      '--msg-danger',
      '--msg-radius-bubble',
      '--msg-motion-fast',
    ];

    assert.ok(content.includes(':root'), 'dm-chat.css must contain :root token definition');
    for (const v of expectedCssVars) {
      assert.ok(content.includes(v), `dm-chat.css must define: ${v}`);
    }
  });

  // 7. Verified Private Realtime Topic Contract
  test('7. Realtime Topic Contract: dm-service.js issues dm:<convUUID>:<epoch>', () => {
    assert.ok(fs.existsSync(dmServicePath), 'dm-service.js must exist');
    const content = fs.readFileSync(dmServicePath, 'utf8');

    assert.ok(
      content.includes('topic: `dm:${conversationId}:${conversation.realtime_epoch}`'),
      'DM service must issue dm:<conversationId>:<epoch>'
    );
  });
});
