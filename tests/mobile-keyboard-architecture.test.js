const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Keyboard Architecture V2 — Viewport Resizing Across Chat & Comments', () => {
  const root = path.join(__dirname, '..');
  const stickyComposerPath = path.join(root, 'mobile', 'components', 'ui', 'StickyComposer.tsx');
  const chatScreenPath = path.join(root, 'mobile', 'app', '(tabs)', 'chat.tsx');
  const commentsScreenPath = path.join(root, 'mobile', 'app', 'post', '[id].tsx');
  const appJsonPath = path.join(root, 'mobile', 'app.json');

  const stickyComposerContent = fs.readFileSync(stickyComposerPath, 'utf8');
  const chatScreenContent = fs.readFileSync(chatScreenPath, 'utf8');
  const commentsScreenContent = fs.readFileSync(commentsScreenPath, 'utf8');
  const appJsonContent = fs.readFileSync(appJsonPath, 'utf8');

  test('1. StickyComposer exports useKeyboardViewport and KeyboardContentBoundary', () => {
    assert.match(stickyComposerContent, /export function useKeyboardViewport/);
    assert.match(stickyComposerContent, /export function KeyboardContentBoundary/);
    assert.match(stickyComposerContent, /StickyComposer\.Boundary\s*=\s*KeyboardContentBoundary/);
    assert.match(stickyComposerContent, /useReanimatedKeyboardAnimation/);
  });

  test('2. KeyboardContentBoundary animates marginBottom in lockstep with KeyboardStickyView', () => {
    // Both boundary lift and sticky view offset must compute lockstep offset
    assert.match(stickyComposerContent, /interpolate\(progress\.value,\s*\[0,\s*1\],\s*\[0,\s*openedOffset\]\)/);
    assert.match(stickyComposerContent, /Math\.max\(0,\s*-\(height\.value\s*\+\s*offset\)\)/);
    assert.match(stickyComposerContent, /marginBottom:\s*lift/);
  });

  test('3. Chat screen wraps message list in KeyboardContentBoundary without scroll hacks', () => {
    // Structural boundary wrapping
    assert.match(chatScreenContent, /<KeyboardContentBoundary/);
    assert.match(chatScreenContent, /<\/KeyboardContentBoundary>/);

    // V1 scrollToOffset onLayout hack must be removed
    assert.doesNotMatch(chatScreenContent, /listLayoutHeightRef/);
    assert.doesNotMatch(chatScreenContent, /onLayout=\{[^}]*scrollToOffset/);

    // Floating button resides inside boundary with sane relative positioning
    assert.match(chatScreenContent, /floatingScrollBtnWithTyping/);
    assert.match(chatScreenContent, /bottom:\s*14/);
  });

  test('4. Comments screen wraps ScrollView in KeyboardContentBoundary without onFocus setTimeout hack', () => {
    // Structural boundary wrapping
    assert.match(commentsScreenContent, /<KeyboardContentBoundary/);
    assert.match(commentsScreenContent, /<\/KeyboardContentBoundary>/);

    // onFocus setTimeout scrollToEnd hack must be removed
    assert.doesNotMatch(commentsScreenContent, /onFocus=\{[^}]*scrollToEnd/);
  });

  test('5. Android native softwareKeyboardLayoutMode is set to resize', () => {
    const appJson = JSON.parse(appJsonContent);
    assert.equal(
      appJson.expo?.android?.softwareKeyboardLayoutMode,
      'resize',
      'Android softwareKeyboardLayoutMode must be "resize"'
    );
  });
});
