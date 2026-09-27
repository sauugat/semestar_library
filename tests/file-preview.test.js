const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Note & File Preview - Component & Logic Verification', async (t) => {
  const previewComponentPath = path.join(__dirname, '../mobile/components/FullScreenFilePreview.tsx');
  const materialScreenPath = path.join(__dirname, '../mobile/app/material/[id].tsx');
  const libraryScreenPath = path.join(__dirname, '../mobile/app/(tabs)/library.tsx');
  const searchOverlayPath = path.join(__dirname, '../mobile/components/SearchOverlay.tsx');
  const indexScreenPath = path.join(__dirname, '../mobile/app/(tabs)/index.tsx');

  await t.test('FullScreenFilePreview exists and has correct imports and props', () => {
    assert.ok(fs.existsSync(previewComponentPath), 'FullScreenFilePreview.tsx should exist');
    const content = fs.readFileSync(previewComponentPath, 'utf8');

    // Verification of ScreenOrientation integration
    assert.match(content, /expo-screen-orientation/, 'Must import expo-screen-orientation');
    assert.match(content, /ScreenOrientation\.unlockAsync/, 'Must call unlockAsync on preview open');
    assert.match(content, /ScreenOrientation\.lockAsync.*PORTRAIT_UP/, 'Must lock back to PORTRAIT_UP on close/unmount');

    // Verification of full-screen modal without chrome
    assert.match(content, /<Modal[\s\S]*visible=\{visible\}[\s\S]*statusBarTranslucent=\{true\}/, 'Must use full-screen statusBarTranslucent modal');
    assert.match(content, /accessibilityLabel="Close file preview"/, 'Must have clear close/back button');

    // Verification of manual orientation toggle
    assert.match(content, /handleToggleOrientation/, 'Must support orientation toggle');
    assert.match(content, /OrientationLock\.LANDSCAPE/, 'Must support landscape locking/switching');
  });

  await t.test('Zoom & Pan support in both orientations', () => {
    const content = fs.readFileSync(previewComponentPath, 'utf8');

    // PDF.js zoom & pan viewport
    assert.match(content, /user-scalable=yes/, 'Viewport must enable user-scalable for pinch-to-zoom');
    assert.match(content, /maximum-scale=5\.0/, 'Viewport must support maximum-scale of at least 5.0');
    assert.match(content, /touch-action:\s*pan-x pan-y pinch-zoom/, 'Must enable CSS touch-action for pan and pinch-zoom');

    // PDF rendering with canvas scaling
    assert.match(content, /getViewport\(\{\s*scale:/, 'PDF.js must configure high-res viewport scale');
  });

  await t.test('Supports all file types (PDF, images, office/documents)', () => {
    const content = fs.readFileSync(previewComponentPath, 'utf8');

    // File categorization
    assert.match(content, /function getFileCategory/, 'Must categorize file extensions');
    assert.match(content, /\.pdf/, 'Must handle PDF files');
    assert.match(content, /\.webp|\.png|\.jpg|\.jpeg/, 'Must handle image files');
    assert.match(content, /\.pptx|\.docx/, 'Must handle document files');

    // Image HTML generator
    assert.match(content, /function getImageHtml/, 'Must generate dedicated HTML for zoomable images');
    assert.match(content, /data:\$\{mime\};base64/, 'Must render image with proper MIME type');
  });

  await t.test('Loading state and error handling with retry', () => {
    const content = fs.readFileSync(previewComponentPath, 'utf8');

    // Loading state with spinner and progress
    assert.match(content, /ActivityIndicator/, 'Must show smooth loading spinner');
    assert.match(content, /progressTrack/, 'Must display download progress track');

    // Error state with retry
    assert.match(content, /Couldn't load this file/, 'Must show user-friendly error message');
    assert.match(content, /Try Again/, 'Must provide retry button');
    assert.match(content, /onPress=\{preparePreview\}/, 'Retry button must re-trigger preview preparation');
  });

  await t.test('Material screen integration eliminates embedded viewer', () => {
    const content = fs.readFileSync(materialScreenPath, 'utf8');

    // No small 480px embedded viewer
    assert.doesNotMatch(content, /height:\s*480/, 'Must NOT contain small 480px embedded viewer');

    // Uses FullScreenFilePreview component
    assert.match(content, /FullScreenFilePreview/, 'Must use FullScreenFilePreview component');
    assert.match(content, /setShowPreview\(true\)/, 'Must open full-screen preview on demand');

    // Automatic preview when preview=1 param passed
    assert.match(content, /preview === '1' \|\| preview === 'true'/, 'Must automatically open preview if preview query param is present');
  });

  await t.test('Library and Search routes pass preview=1 on note tap', () => {
    const libraryContent = fs.readFileSync(libraryScreenPath, 'utf8');
    assert.match(libraryContent, /\/material\/\$\{file\.id\}\?preview=1/, 'Library note card tap must pass ?preview=1');

    const searchContent = fs.readFileSync(searchOverlayPath, 'utf8');
    assert.match(searchContent, /\/material\/\$\{file\.id\}\?preview=1/, 'Search overlay note tap must pass ?preview=1');
  });

  await t.test('Feed screen unlocks orientation during full-screen image viewing', () => {
    const indexContent = fs.readFileSync(indexScreenPath, 'utf8');
    assert.match(indexContent, /ScreenOrientation\.unlockAsync/, 'Feed must unlock orientation for image viewer');
    assert.match(indexContent, /viewerImageUri/, 'Image viewer must be connected to orientation effect');
  });

  await t.test('FullScreenFilePreview adheres to app theme tokens in dark mode', () => {
    const content = fs.readFileSync(previewComponentPath, 'utf8');

    // Theme hook integration
    assert.match(content, /useTheme/, 'Must import and use useTheme hook');
    assert.match(content, /const\s*\{\s*colors,\s*isDark\s*\}\s*=\s*useTheme\(\)/, 'Must extract colors and isDark from useTheme');

    // No hardcoded slate-navy or indigo palettes
    assert.doesNotMatch(content, /#0A0F1D/i, 'Must not use hardcoded slate-navy #0A0F1D');
    assert.doesNotMatch(content, /#6366F1/i, 'Must not use hardcoded indigo #6366F1');

    // App theme dark tokens (#0a0a0a) in HTML templates & styling
    assert.match(content, /#0a0a0a/, 'Must use app dark background token #0a0a0a');
    assert.match(content, /#f5f5f5/, 'Must use app monochrome text/primary token #f5f5f5');
    assert.match(content, /colors\.primary/, 'Must use colors.primary for spinner/buttons');
    assert.match(content, /colors\.surfaceRaised/, 'Must use colors.surfaceRaised for elevated elements');
  });
});
