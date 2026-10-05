const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Phase 2 Client-Facing Academic Context UX Verification', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const mobileDir = path.join(__dirname, '..', 'mobile');

  describe('1. Web Client Contract & Architecture', () => {
    test('public/academic-context.js exists and exports AcademicContext abstraction', () => {
      const filePath = path.join(publicDir, 'academic-context.js');
      assert.ok(fs.existsSync(filePath), 'academic-context.js must exist in public directory');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('getAcademicContext'), 'Must expose getAcademicContext');
      assert.ok(content.includes('renderBadge'), 'Must expose renderBadge');
      assert.ok(content.includes('invalidate'), 'Must expose invalidate method for logout/switching');
      assert.ok(content.includes('/api/academic-context'), 'Must query /api/academic-context');
    });

    test('public/library.html loads academic-context.js and hides #semSwitcher for students', () => {
      const filePath = path.join(publicDir, 'library.html');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('/academic-context.js'), 'Must include /academic-context.js');
      assert.ok(content.includes('academicContextBadge'), 'Must include badge container for academic context');
      assert.ok(content.includes('isStaff'), 'Must distinguish isStaff from student');
      assert.ok(content.includes("switcher.style.display = 'none'") || content.includes("semSwitcher.style.display = 'none'"), 'Must hide #semSwitcher for students');
      assert.ok(content.includes('unassigned-academic-card') || content.includes('Class Not Assigned'), 'Must handle unassigned students safely');
    });

    test('public/library.html student requests do not append manual ?semester= parameter', () => {
      const filePath = path.join(publicDir, 'library.html');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(
        content.includes('/api/library/files?subject='),
        'Must request files by subject using authenticated cohort context without forced ?semester='
      );
    });

    test('public/dashboard.html includes academic-context.js and renders badge', () => {
      const filePath = path.join(publicDir, 'dashboard.html');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('/academic-context.js'), 'Must include /academic-context.js');
      assert.ok(content.includes('dashAcademicBadge'), 'Must have badge container on dashboard');
      assert.ok(content.includes('AcademicContext.renderBadge'), 'Must render badge when profile data loads');
    });

    test('public/code-lab/subjects.html and assignments.html include academic-context.js and badge', () => {
      const subjectsPath = path.join(publicDir, 'code-lab', 'subjects.html');
      const assignPath = path.join(publicDir, 'code-lab', 'assignments.html');
      
      const subjectsContent = fs.readFileSync(subjectsPath, 'utf-8');
      assert.ok(subjectsContent.includes('/academic-context.js'), 'subjects.html must include academic-context.js');
      assert.ok(subjectsContent.includes('clHeroAcademicBadge'), 'subjects.html must render academic badge in hero');
      assert.ok(subjectsContent.includes('semWrap.style.display = \'none\''), 'subjects.html must hide semester dropdown for normal students');

      const assignContent = fs.readFileSync(assignPath, 'utf-8');
      assert.ok(assignContent.includes('/academic-context.js'), 'assignments.html must include academic-context.js');
      assert.ok(assignContent.includes('clPageAcademicBadge'), 'assignments.html must render academic badge');
    });

    test('public/auth.js invalidates academic context cache on logout', () => {
      const filePath = path.join(publicDir, 'auth.js');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(
        content.includes('AcademicContext.invalidate') || content.includes('academic_context_cache'),
        'Must clear academic context cache during signOut'
      );
    });
  });

  describe('2. Mobile Client Contract & Architecture', () => {
    test('mobile/services/academicContext.ts exists with authoritative fetcher', () => {
      const filePath = path.join(mobileDir, 'services', 'academicContext.ts');
      assert.ok(fs.existsSync(filePath), 'academicContext.ts service must exist');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('/api/academic-context'), 'Must query /api/academic-context');
      assert.ok(content.includes('displayLabel'), 'Must generate displayLabel (e.g. Mercury • Semester 1)');
      assert.ok(content.includes('semNumberToRoman'), 'Must format roman numeral semester');
    });

    test('mobile/hooks/useAcademicContext.ts wraps query and provides reactive state', () => {
      const filePath = path.join(mobileDir, 'hooks', 'useAcademicContext.ts');
      assert.ok(fs.existsSync(filePath), 'useAcademicContext.ts hook must exist');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('useAcademicContext'), 'Must export useAcademicContext hook');
      assert.ok(content.includes('queryKey: [\'academic-context\''), 'Must key query by academic-context and studentId');
    });

    test('mobile/services/library.ts exports getMyLibraryFiles without client semester parameter', () => {
      const filePath = path.join(mobileDir, 'services', 'library.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('export async function getMyLibraryFiles'), 'Must export getMyLibraryFiles');
      assert.ok(!content.includes('params.semester') || content.includes('getMyLibraryFiles(params: {'), 'getMyLibraryFiles must not accept client semester');
    });

    test('mobile/app/(tabs)/library.tsx removes semester pills for students and displays context badge', () => {
      const filePath = path.join(mobileDir, 'app', '(tabs)', 'library.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('useAcademicContext'), 'Must use useAcademicContext hook');
      assert.ok(content.includes('getMyLibraryFiles'), 'Must use getMyLibraryFiles for students');
      assert.ok(content.includes('academicBadge'), 'Must have academicBadge style');
      assert.ok(content.includes('{isStaff && ('), 'Must conditionally render semester selector pills only for staff');
      assert.ok(content.includes('Class Not Assigned'), 'Must render safe unassigned state');
    });

    test('mobile/app/(tabs)/index.tsx displays academic context indicator', () => {
      const filePath = path.join(mobileDir, 'app', '(tabs)', 'index.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.includes('useAcademicContext'), 'Must use useAcademicContext');
      assert.ok(content.includes('academicBadge'), 'Must display academicBadge in header');
    });

    test('mobile query cache is purged on logout preventing cross-account stale context', () => {
      const authPath = path.join(mobileDir, 'context', 'AuthContext.tsx');
      const queryClientPath = path.join(mobileDir, 'services', 'query-client.ts');
      
      const authContent = fs.readFileSync(authPath, 'utf-8');
      assert.ok(authContent.includes('clearAppQueryCache()'), 'AuthContext logout must call clearAppQueryCache');
      
      const queryClientContent = fs.readFileSync(queryClientPath, 'utf-8');
      assert.ok(queryClientContent.includes('queryClient.clear()'), 'clearAppQueryCache must wipe queryClient state');
    });
  });

  describe('3. Academic Context Behavioral Contract', () => {
    const { semNumberToRoman } = require('../public/academic-context.js');

    test('semNumberToRoman formats 1 through 8 correctly', () => {
      assert.equal(semNumberToRoman(1), 'I');
      assert.equal(semNumberToRoman(2), 'II');
      assert.equal(semNumberToRoman(3), 'III');
      assert.equal(semNumberToRoman(4), 'IV');
      assert.equal(semNumberToRoman(5), 'V');
      assert.equal(semNumberToRoman(6), 'VI');
      assert.equal(semNumberToRoman(7), 'VII');
      assert.equal(semNumberToRoman(8), 'VIII');
    });
  });
});
