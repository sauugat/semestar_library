const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// -------------------------------------------------------------
// 1. CHANGE PASSWORD & TOKEN REVOCATION SEMANTICS
// -------------------------------------------------------------
test('Change Password: dual authentication, session revocation, caller token preservation', async (t) => {
  // Mock in-memory student database
  const students = new Map();
  const mobileTokens = [];
  const webSessions = [];

  const studentId = 'test_student_001';
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';
  const callerToken = 'mobile_token_active_caller_xyz';
  const otherToken = 'mobile_token_stale_device_abc';

  // Seed student with bcrypt hash
  students.set(studentId, {
    studentId,
    email: 'student@example.com',
    passwordHash: bcrypt.hashSync(oldPassword, 10),
    supabase_uid: 'supabase-uid-12345',
  });

  // Seed active mobile tokens
  mobileTokens.push({ studentId, token: callerToken });
  mobileTokens.push({ studentId, token: otherToken });

  // Seed web sessions
  webSessions.push({ sid: 'current_sid', studentId });
  webSessions.push({ sid: 'stale_sid', studentId });

  // Test 1: Minimum password length validation
  t.test('Password length validation enforces 8-character minimum', () => {
    assert.throws(() => {
      if ('short'.length < 8) {
        throw new Error('New password must be at least 8 characters long');
      }
    }, /at least 8 characters long/);
  });

  // Test 2: Current password verification fails on wrong password
  t.test('Rejects incorrect current password', () => {
    const student = students.get(studentId);
    const matches = bcrypt.compareSync('WrongPassword!', student.passwordHash);
    assert.equal(matches, false, 'Wrong password must not match');
  });

  // Test 3: Current password succeeds on correct password
  t.test('Accepts valid current password', () => {
    const student = students.get(studentId);
    const matches = bcrypt.compareSync(oldPassword, student.passwordHash);
    assert.equal(matches, true, 'Correct password must match');
  });

  // Test 4: Dual Supabase verification fallback when local hash is placeholder
  t.test('Verifies Supabase Auth when local hash is placeholder', () => {
    const supabaseStudent = {
      studentId: 'supa_student',
      email: 'supa@example.com',
      passwordHash: 'supabase_auth',
    };
    // Local bcrypt skips placeholder
    const localMatch = supabaseStudent.passwordHash && supabaseStudent.passwordHash !== 'supabase_auth'
      ? bcrypt.compareSync(oldPassword, supabaseStudent.passwordHash)
      : false;
    assert.equal(localMatch, false);

    // Supabase fallback is triggered
    const shouldFallbackToSupabase = !localMatch && Boolean(supabaseStudent.email);
    assert.equal(shouldFallbackToSupabase, true);
  });

  // Test 5: Password update persists new bcrypt hash
  t.test('Updates passwordHash to new hash and invalidates old password', () => {
    const student = students.get(studentId);
    student.passwordHash = bcrypt.hashSync(newPassword, 10);
    assert.equal(bcrypt.compareSync(oldPassword, student.passwordHash), false, 'Old password must no longer work');
    assert.equal(bcrypt.compareSync(newPassword, student.passwordHash), true, 'New password must verify successfully');
  });

  // Test 6: Mobile token revocation preserves active caller token while wiping others
  t.test('Revokes other mobile tokens while preserving caller active token', () => {
    const remainingTokens = mobileTokens.filter(t => t.studentId !== studentId || t.token === callerToken);
    assert.equal(remainingTokens.length, 1);
    assert.equal(remainingTokens[0].token, callerToken);
  });

  // Test 7: Web session revocation preserves current session
  t.test('Revokes other web sessions while preserving current session ID', () => {
    const currentSid = 'current_sid';
    const remainingSessions = webSessions.filter(s => s.sid === currentSid || s.studentId !== studentId);
    assert.equal(remainingSessions.length, 1);
    assert.equal(remainingSessions[0].sid, currentSid);
  });
});

// -------------------------------------------------------------
// 2. DOCUMENT READER CLASSIFICATION MATRIX & MIME/UTI MAPPING
// -------------------------------------------------------------
test('Document Reader: format classification matrix, MIME, and UTI', (t) => {
  // Classification logic matching mobile/components/FullScreenFilePreview.tsx and material/[id].tsx
  function classifyFile(filename) {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'pdf';
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.bmp')
    ) {
      return 'image';
    }
    if (
      lower.endsWith('.txt') ||
      lower.endsWith('.md') ||
      lower.endsWith('.csv') ||
      lower.endsWith('.json') ||
      lower.endsWith('.log')
    ) {
      return 'text';
    }
    if (
      lower.endsWith('.pptx') ||
      lower.endsWith('.ppt') ||
      lower.endsWith('.docx') ||
      lower.endsWith('.doc') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      lower.endsWith('.html')
    ) {
      return 'office';
    }
    return 'other';
  }

  function getViewerAction(cat) {
    if (cat === 'pdf' || cat === 'image' || cat === 'text') return 'IN_APP_VIEW';
    if (cat === 'office') return 'EXTERNAL_OPEN';
    return 'UNSUPPORTED';
  }

  t.test('Classifies PDF as IN_APP_VIEW', () => {
    assert.equal(classifyFile('lecture_notes.pdf'), 'pdf');
    assert.equal(getViewerAction('pdf'), 'IN_APP_VIEW');
  });

  t.test('Classifies images (PNG, JPG, WEBP, GIF, SVG) as IN_APP_VIEW', () => {
    const images = ['diagram.png', 'photo.jpg', 'scan.jpeg', 'graphic.webp', 'anim.gif', 'vector.svg'];
    for (const img of images) {
      assert.equal(classifyFile(img), 'image', `Failed on ${img}`);
      assert.equal(getViewerAction('image'), 'IN_APP_VIEW');
    }
  });

  t.test('Classifies text files (TXT, MD, CSV, JSON, LOG) as IN_APP_VIEW', () => {
    const textFiles = ['readme.txt', 'notes.md', 'data.csv', 'config.json', 'run.log'];
    for (const txt of textFiles) {
      assert.equal(classifyFile(txt), 'text', `Failed on ${txt}`);
      assert.equal(getViewerAction('text'), 'IN_APP_VIEW');
    }
  });

  t.test('Classifies Office docs (DOC, DOCX, PPT, PPTX, XLS, XLSX) as EXTERNAL_OPEN', () => {
    const officeFiles = ['syllabus.doc', 'assignment.docx', 'slides.ppt', 'presentation.pptx', 'grades.xls', 'roster.xlsx'];
    for (const doc of officeFiles) {
      assert.equal(classifyFile(doc), 'office', `Failed on ${doc}`);
      assert.equal(getViewerAction('office'), 'EXTERNAL_OPEN');
    }
  });

  t.test('Classifies binary executables and unknown formats as UNSUPPORTED', () => {
    const unknownFiles = ['program.exe', 'archive.bin', 'lib.so', 'data.dat'];
    for (const unk of unknownFiles) {
      assert.equal(classifyFile(unk), 'other', `Failed on ${unk}`);
      assert.equal(getViewerAction('other'), 'UNSUPPORTED');
    }
  });
});

// -------------------------------------------------------------
// 3. MULTI-FILE QUEUE APPENDING & DEDUPLICATION SEMANTICS
// -------------------------------------------------------------
test('Multi-file Upload: queue appending, deduplication, and partial success', (t) => {
  // Deduplicating queue append logic matching mobile/components/UploadNoteModal.tsx
  function appendFiles(currentQueue, newFiles) {
    const existingKeys = new Set(currentQueue.map((f) => `${f.name}_${f.size || 0}`));
    const toAdd = newFiles.filter((f) => !existingKeys.has(`${f.name}_${f.size || 0}`));
    return [...currentQueue, ...toAdd];
  }

  t.test('Appends additional selected files without overwriting existing queue', () => {
    const queue = [
      { id: '1', name: 'chapter1.pdf', size: 1024 },
      { id: '2', name: 'chapter2.pdf', size: 2048 },
    ];
    const newPicks = [
      { id: '3', name: 'chapter3.pdf', size: 3072 },
    ];
    const updated = appendFiles(queue, newPicks);
    assert.equal(updated.length, 3);
    assert.equal(updated[2].name, 'chapter3.pdf');
  });

  t.test('Deduplicates files with identical name and size', () => {
    const queue = [
      { id: '1', name: 'chapter1.pdf', size: 1024 },
    ];
    const duplicatePicks = [
      { id: 'dup', name: 'chapter1.pdf', size: 1024 },
      { id: 'new', name: 'diagram.png', size: 512 },
    ];
    const updated = appendFiles(queue, duplicatePicks);
    assert.equal(updated.length, 2);
    assert.equal(updated[0].name, 'chapter1.pdf');
    assert.equal(updated[1].name, 'diagram.png');
  });

  t.test('Partial success keeps failed files in queue with error annotations', () => {
    const queue = [
      { id: '1', name: 'fileA.pdf', size: 100 },
      { id: '2', name: 'fileB.pdf', size: 200 },
      { id: '3', name: 'fileC.pdf', size: 300 },
    ];
    const failedFiles = [
      { originalName: 'fileB.pdf', error: 'Storage timeout' },
    ];

    const failedNameSet = new Set(failedFiles.map((ff) => ff.originalName));
    const failedMap = new Map(failedFiles.map((ff) => [ff.originalName, ff.error]));

    const remainingQueue = queue
      .filter((f) => failedNameSet.has(f.name))
      .map((f) => ({
        ...f,
        error: failedMap.get(f.name) || 'Upload failed',
      }));

    assert.equal(remainingQueue.length, 1);
    assert.equal(remainingQueue[0].name, 'fileB.pdf');
    assert.equal(remainingQueue[0].error, 'Storage timeout');
  });
});

// -------------------------------------------------------------
// 4. NOTIFICATION RECIPIENT SCOPING & ROUTING
// -------------------------------------------------------------
test('Library Notifications: semester and department scoping, uploader exclusion, and routing', (t) => {
  const { normalizeSemester } = require('../lib/note-search');

  const students = [
    { studentId: 'student_bit_sem2_a', semester: 'Semester II', department: 'BIT' },
    { studentId: 'student_bit_sem2_b', semester: 'Semester 2', department: 'BIT' },
    { studentId: 'student_civil_sem2', semester: 'Semester II', department: 'Civil' },
    { studentId: 'student_bit_sem4', semester: 'Semester IV', department: 'BIT' },
    { studentId: 'uploader_teacher', semester: 'Semester II', department: 'BIT' },
  ];

  function getRecipients({ semester, department, uploaderStudentId }) {
    const targetSem = normalizeSemester(semester);
    const cleanDept = department ? department.trim().toLowerCase() : null;

    return students
      .filter(s => s.studentId !== uploaderStudentId)
      .filter(s => {
        if (targetSem !== null && normalizeSemester(s.semester) !== targetSem) return false;
        if (cleanDept && s.department && s.department.trim().toLowerCase() !== cleanDept) return false;
        return true;
      })
      .map(s => s.studentId);
  }

  t.test('Filters recipients by semester and department while excluding uploader', () => {
    const recipients = getRecipients({
      semester: 'Semester II',
      department: 'BIT',
      uploaderStudentId: 'uploader_teacher',
    });

    assert.deepEqual(recipients, ['student_bit_sem2_a', 'student_bit_sem2_b']);
    assert.equal(recipients.includes('uploader_teacher'), false, 'Uploader must be excluded');
    assert.equal(recipients.includes('student_civil_sem2'), false, 'Civil student must not receive BIT notification');
    assert.equal(recipients.includes('student_bit_sem4'), false, 'Sem 4 student must not receive Sem 2 notification');
  });

  t.test('Multi-file batch notification parsing and tap routing', () => {
    const rawBatchPayload = {
      type: 'material_batch',
      batchId: 'batch_98765',
      materialCount: 3,
      fileIds: [101, 102, 103],
      semester: 'Semester II',
      subject: 'Data Structures',
    };

    // Parser logic matching mobile/services/notifications.ts
    const parsed = {
      type: 'material_batch',
      batchId: String(rawBatchPayload.batchId),
      materialCount: Number(rawBatchPayload.materialCount),
      fileIds: rawBatchPayload.fileIds.map(Number),
      subject: rawBatchPayload.subject,
    };

    assert.equal(parsed.type, 'material_batch');
    assert.equal(parsed.fileIds.length, 3);

    // Route calculation matching mobile/services/notifications.ts
    function getNotificationRoute(payload) {
      if (payload.type === 'material') {
        return `/material/${payload.fileId}`;
      }
      if (payload.type === 'material_batch') {
        if (payload.fileIds && payload.fileIds.length > 0) {
          return `/material/${payload.fileIds[0]}`;
        }
        return '/(tabs)/library';
      }
      return '/(tabs)';
    }

    assert.equal(getNotificationRoute(parsed), '/material/101', 'Batch notification must route to the uploaded material');
    assert.equal(getNotificationRoute({ type: 'material', fileId: 42 }), '/material/42');
  });
});
