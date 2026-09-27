const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Library Header & Upload Flow - Verification', async (t) => {
  const libraryScreenPath = path.join(__dirname, '../mobile/app/(tabs)/library.tsx');
  const uploadModalPath = path.join(__dirname, '../mobile/components/UploadNoteModal.tsx');
  const searchOverlayPath = path.join(__dirname, '../mobile/components/SearchOverlay.tsx');
  const libraryServicePath = path.join(__dirname, '../mobile/services/library.ts');

  await t.test('Library header uses exact Home tab wordmark and styling without "Academic Library"', () => {
    assert.ok(fs.existsSync(libraryScreenPath), 'library.tsx must exist');
    const content = fs.readFileSync(libraryScreenPath, 'utf8');

    // Confirm "Academic Library" is removed
    assert.doesNotMatch(content, /Academic Library/, 'Must NOT contain "Academic Library" header');

    // Confirm tabs layout has headerShown: false for library
    const tabsLayoutPath = path.join(__dirname, '../mobile/app/(tabs)/_layout.tsx');
    assert.ok(fs.existsSync(tabsLayoutPath), '_layout.tsx must exist');
    const layoutContent = fs.readFileSync(tabsLayoutPath, 'utf8');
    assert.doesNotMatch(layoutContent, /headerTitle:\s*['"]Academic Library['"]/, 'Must NOT have Academic Library headerTitle in _layout.tsx');
    assert.match(layoutContent, /name="library"[\s\S]*headerShown:\s*false/, 'Library tab in _layout.tsx must set headerShown: false');

    // Confirm "Semester Library" wordmark is used with PlusJakartaSans_800ExtraBold
    assert.match(content, /Semester Library/, 'Must use "Semester Library" wordmark');
    assert.match(content, /PlusJakartaSans_800ExtraBold/, 'Must use PlusJakartaSans_800ExtraBold');

    // Confirm headerRightActions contains Search and Add note buttons
    assert.match(content, /accessibilityLabel="Search notes"/, 'Must contain search button');
    assert.match(content, /accessibilityLabel="Add note"/, 'Must contain add note (+) button');
    assert.match(content, /styles\.headerActionBtn/, 'Must use identical action button styling');
  });

  await t.test('Search icon is wired specifically to notes/files search', () => {
    const content = fs.readFileSync(libraryScreenPath, 'utf8');

    // SearchOverlay mounted with filterType="files"
    assert.match(content, /<SearchOverlay[\s\S]*visible=\{searchOpen\}[\s\S]*filterType="files"/, 'SearchOverlay must be mounted with filterType="files"');

    // SearchOverlay component supports filterType="files"
    const searchContent = fs.readFileSync(searchOverlayPath, 'utf8');
    assert.match(searchContent, /filterType\?: 'all' \| 'files'/, 'SearchOverlayProps must support filterType');
    assert.match(searchContent, /filterType === 'files' \? 'Search Library Notes' : 'Search Campus'/, 'SearchOverlay must adapt placeholder/empty text for files');
  });

  await t.test('Add Note (+) icon is wired to UploadNoteModal matching web flow', () => {
    const libraryContent = fs.readFileSync(libraryScreenPath, 'utf8');
    assert.match(libraryContent, /<UploadNoteModal[\s\S]*visible=\{uploadModalOpen\}/, 'UploadNoteModal must be mounted on Library');

    assert.ok(fs.existsSync(uploadModalPath), 'UploadNoteModal.tsx must exist');
    const uploadContent = fs.readFileSync(uploadModalPath, 'utf8');

    // Flow matching website: semester -> subject -> chapter -> file picker -> title
    assert.match(uploadContent, /expo-document-picker/, 'Must use expo-document-picker for file selection');
    assert.match(uploadContent, /SEMESTERS/, 'Must use static curriculum SEMESTERS for semester/subject/chapter selection');
    assert.match(uploadContent, /handleSelectSemester/, 'Must handle semester changes and cascade subjects');
    assert.match(uploadContent, /handleSelectSubject/, 'Must handle subject changes and cascade chapters');
    assert.match(uploadContent, /\+ Custom Subject/, 'Must support custom subject entry matching website');
    assert.match(uploadContent, /uploadNote/, 'Must submit note through uploadNote service');

    // Validation
    assert.match(uploadContent, /Please select a file to upload/, 'Must validate file selection');
    assert.match(uploadContent, /Please select or specify a subject/, 'Must validate subject selection');
  });

  await t.test('uploadNote service uses POST /api/files/upload with FormData', () => {
    const serviceContent = fs.readFileSync(libraryServicePath, 'utf8');

    assert.match(serviceContent, /export async function uploadNote/, 'Must export uploadNote function');
    assert.match(serviceContent, /\/api\/files\/upload/, 'Must call /api/files/upload endpoint');
    assert.match(serviceContent, /formData\.append\('files'/, 'Must append file to FormData');
    assert.match(serviceContent, /formData\.append\('semester'/, 'Must append semester to FormData');
    assert.match(serviceContent, /formData\.append\('subject'/, 'Must append subject to FormData');
  });

  await t.test('Pills and chips use high contrast colors in both selected and unselected states', () => {
    const libraryContent = fs.readFileSync(libraryScreenPath, 'utf8');
    const uploadContent = fs.readFileSync(uploadModalPath, 'utf8');

    // Library semester selector pills must use primaryText for selected and text for unselected
    assert.match(
      libraryContent,
      /color:\s*isSelected\s*\?\s*colors\.primaryText\s*:\s*colors\.text/,
      'Library semester pill must use colors.primaryText when selected and colors.text when unselected'
    );

    // UploadNoteModal must NOT use #FFFFFF on colors.primary
    assert.doesNotMatch(
      uploadContent,
      /color:\s*isSelected\s*\?\s*['"]#FFFFFF['"]/,
      'UploadNoteModal must NOT put #FFFFFF text on colors.primary (which is near-white in dark mode)'
    );

    assert.match(
      uploadContent,
      /color:\s*isSelected\s*\?\s*colors\.primaryText/,
      'UploadNoteModal chips must use colors.primaryText when selected'
    );
  });

  await t.test('Library screen merges custom subjects from getLibraryStats into curriculum', () => {
    const libraryContent = fs.readFileSync(libraryScreenPath, 'utf8');

    assert.match(libraryContent, /getLibraryStats/, 'Library must fetch library stats');
    assert.match(libraryContent, /code:\s*['"]CUSTOM['"]/, 'Library must tag custom subjects');
    assert.match(libraryContent, /isMatchingSemester/, 'Library must match subjects by semester');
  });
});
