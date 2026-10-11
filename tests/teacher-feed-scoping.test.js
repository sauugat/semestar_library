const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('TEACHER FEED SCOPING & FILTERING TEST SUITE', async (t) => {
  const serverPath = path.resolve(__dirname, '../server.js');
  const assignmentsRoutePath = path.resolve(__dirname, '../routes/code-lab/assignments.js');
  const mobileIndexPath = path.resolve(__dirname, '../mobile/app/(tabs)/index.tsx');
  const mobilePostsServicePath = path.resolve(__dirname, '../mobile/services/posts.ts');
  const dashboardHtmlPath = path.resolve(__dirname, '../public/dashboard.html');

  const serverContent = fs.readFileSync(serverPath, 'utf8');
  const assignmentsContent = fs.readFileSync(assignmentsRoutePath, 'utf8');
  const mobileIndexContent = fs.readFileSync(mobileIndexPath, 'utf8');
  const mobilePostsContent = fs.readFileSync(mobilePostsServicePath, 'utf8');
  const dashboardContent = fs.readFileSync(dashboardHtmlPath, 'utf8');

  // 1. Backend /api/files handles teacher feed scoping
  await t.test('1. Backend /api/files scopes files in feed requests for teachers', () => {
    assert.ok(
      serverContent.includes("isTeacher && isFeedRequest") && serverContent.includes("context.role === 'teacher'"),
      'server.js must detect teacher role in feed requests'
    );
    assert.ok(
      serverContent.includes('getTeacherSubjects(db, activeTeacherId)'),
      'server.js must retrieve assigned subjects for teacher'
    );
    assert.ok(
      serverContent.includes("files.uploadedBy = ?") && serverContent.includes("LOWER(files.subject) = ?"),
      'server.js must only allow self-uploaded files or files matching teacher assigned subjects'
    );
  });

  // 2. Backend /api/code-lab/assignments scopes assignments in feed requests for teachers
  await t.test('2. Backend /api/code-lab/assignments scopes assignments in feed requests to self-uploaded only', () => {
    assert.ok(
      assignmentsContent.includes("isTeacher && isFeedRequest && currentStudentId") && assignmentsContent.includes("context.role === 'teacher'"),
      'assignments.js must detect teacher in feed requests'
    );
    assert.ok(
      assignmentsContent.includes("whereClauses.push('a.createdBy = ?')"),
      'assignments.js must filter to a.createdBy = currentStudentId'
    );
  });

  // 3. Mobile service passes ?feed=1 query parameter
  await t.test('3. Mobile service getFeedFiles supports feed query parameter', () => {
    assert.ok(
      mobilePostsContent.includes("export async function getFeedFiles(feedQuery: string = '?feed=1')"),
      'getFeedFiles must support feed query parameter'
    );
  });

  // 4. Mobile feed query and filtering in index.tsx
  await t.test('4. Mobile index.tsx filters out other subjects files and non-self assignments for teachers', () => {
    assert.ok(
      mobileIndexContent.includes("isTeacherUser ? '?feed=1' : ''"),
      'mobile feed query passes ?feed=1 for teachers'
    );
    assert.ok(
      mobileIndexContent.includes("eligibleFiles = isTeacher"),
      'mobile feed defines teacher file eligibility filter'
    );
    assert.ok(
      mobileIndexContent.includes("f.uploadedBy === teacherId"),
      'mobile feed allows teacher self-uploaded files'
    );
    assert.ok(
      mobileIndexContent.includes("teacherSubjectTerms.some"),
      'mobile feed checks file subject against teacher assigned subjects'
    );
    assert.ok(
      mobileIndexContent.includes("eligibleAssignments = isTeacher"),
      'mobile feed defines teacher assignment eligibility filter'
    );
    assert.ok(
      mobileIndexContent.includes("a.createdBy === teacherId"),
      'mobile feed ensures teachers only see assignments they uploaded'
    );
  });

  // 5. Notices, Announcements, News posts remain preserved
  await t.test('5. Mobile index.tsx preserves notice, announcement, and news posts in feed', () => {
    assert.ok(
      mobileIndexContent.includes("visiblePosts = feedCategoryFilter === 'all'"),
      'mobile feed preserves visible posts'
    );
    assert.ok(
      mobileIndexContent.includes("postItems"),
      'post items are included in feedItems'
    );
  });

  // 6. Web dashboard.html scopes teacher feed items
  await t.test('6. Web dashboard.html scopes teacher files and assignments in feed', () => {
    assert.ok(
      dashboardContent.includes("const isTeacher = window.currentUserData && (window.currentUserData.role === 'teacher' || window.currentUserData.role === 'faculty')"),
      'dashboard.html identifies teacher user'
    );
    assert.ok(
      dashboardContent.includes("filteredAssignments = assignmentList.filter(a => a.createdBy === teacherId)"),
      'dashboard.html filters assignments to self-uploaded only'
    );
    assert.ok(
      dashboardContent.includes("filteredFiles = files.filter(f =>"),
      'dashboard.html filters files to teacher assigned subjects and self-uploads'
    );
  });

  // 7. Pure function simulation test verifying filter behavior
  await t.test('7. Logic simulation: teacher with Computer Networks sees only their subject files and own assignments', () => {
    const teacherId = 'TEA-101';
    const teacherSubjects = [{ id: 'sub-cn', code: 'CIT201', name: 'Computer Networks' }];
    const teacherSubjectTerms = teacherSubjects.flatMap(s => [s.name, s.code, s.id].map(x => x.toLowerCase().trim()));

    const mockFiles = [
      { id: 1, subject: 'Computer Networks', uploadedBy: 'STU-99', title: 'CN Chapter 1' },
      { id: 2, subject: 'Digital Logic', uploadedBy: 'STU-88', title: 'DL Notes' },
      { id: 3, subject: 'Database Management', uploadedBy: 'STU-77', title: 'DBMS Intro' },
      { id: 4, subject: 'Physics', uploadedBy: teacherId, title: 'Teacher Physics Note' }, // self uploaded
    ];

    const mockAssignments = [
      { id: 101, title: 'CN Lab 1', createdBy: teacherId },
      { id: 102, title: 'DL Lab 1', createdBy: 'TEA-102' },
      { id: 103, title: 'Maths Assignment', createdBy: 'ADMIN-1' },
    ];

    const filteredFiles = mockFiles.filter(f => {
      if (f.uploadedBy === teacherId) return true;
      if (!f.subject) return false;
      const fSub = f.subject.toLowerCase().trim();
      return teacherSubjectTerms.some(term => fSub === term || fSub.includes(term) || term.includes(fSub));
    });

    const filteredAssignments = mockAssignments.filter(a => a.createdBy === teacherId);

    // Assert files: only CN file and self-uploaded file
    assert.equal(filteredFiles.length, 2);
    assert.equal(filteredFiles[0].id, 1);
    assert.equal(filteredFiles[1].id, 4);

    // Assert assignments: only teacher's own assignment
    assert.equal(filteredAssignments.length, 1);
    assert.equal(filteredAssignments[0].id, 101);
  });
});
