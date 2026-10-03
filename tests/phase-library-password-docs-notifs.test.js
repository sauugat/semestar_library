const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');
const officePreview = require('../lib/office-preview');

test('Comprehensive Verification: Password + Document Reader + Multi-Upload + Material Notifications', { timeout: 180000 }, async (t) => {
  process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH = '1';
  t.after(() => { delete process.env.DISABLE_IMMEDIATE_PUSH_DISPATCH; });

  await db.initSchema();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  const ts = Date.now();
  const testStudentId = `STU_PWD_${ts}`;
  const otherStudentId = `STU_OTHER_${ts}`;
  const sem4StudentId = `STU_SEM4_${ts}`;
  const initialPassword = 'InitialPass123!';
  const initialHash = bcrypt.hashSync(initialPassword, 10);

  // Clean outbox and notifications for test users
  await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'STU_%'");
  await db.run("DELETE FROM notifications WHERE recipientStudentId LIKE 'STU_%'");

  // Create test accounts
  const accounts = [
    { id: testStudentId, name: 'Password Test Student', role: 'student', semester: 'Semester 2', department: 'BIT', passwordHash: initialHash },
    { id: otherStudentId, name: 'Classmate Sem 2', role: 'student', semester: 'Semester 2', department: 'BIT', passwordHash: initialHash },
    { id: sem4StudentId, name: 'Senior Sem 4', role: 'student', semester: 'Semester 4', department: 'BIT', passwordHash: initialHash },
  ];

  for (const acc of accounts) {
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO students (studentId, name, role, semester, department, passwordHash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (studentId) DO UPDATE SET passwordHash = EXCLUDED.passwordHash, department = EXCLUDED.department, semester = EXCLUDED.semester',
        acc.id, acc.name, acc.role, acc.semester, acc.department, acc.passwordHash
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO students (studentId, name, role, semester, department, passwordHash) VALUES (?, ?, ?, ?, ?, ?)',
        acc.id, acc.name, acc.role, acc.semester, acc.department, acc.passwordHash
      );
    }
  }

  // Issue primary token and a secondary token for testStudentId to verify token revocation
  const primaryToken = `tok_primary_${testStudentId}_${ts}`;
  const secondaryToken = `tok_secondary_${testStudentId}_${ts}`;
  const expiresAt = new Date(Date.now() + 86400000).toISOString();

  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, CURRENT_TIMESTAMP, ?)', primaryToken, testStudentId, expiresAt);
  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, CURRENT_TIMESTAMP, ?)', secondaryToken, testStudentId, expiresAt);

  // Register device tokens
  await db.run('INSERT INTO student_device_tokens (student_id, expo_push_token, platform, device_name, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', otherStudentId, `ExponentPushToken[dev1_${ts}]`, 'android', 'Phone A');
  await db.run('INSERT INTO student_device_tokens (student_id, expo_push_token, platform, device_name, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', otherStudentId, `ExponentPushToken[dev2_${ts}]`, 'ios', 'iPad B');
  await db.run('INSERT INTO student_device_tokens (student_id, expo_push_token, platform, device_name, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', sem4StudentId, `ExponentPushToken[dev3_${ts}]`, 'android', 'Phone C');

  // =========================================================================
  // SECTION 1: FIX CHANGE PASSWORD TESTS
  // =========================================================================
  await t.test('1.1 Change Password: wrong current password rejected with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${primaryToken}`
      },
      body: JSON.stringify({
        currentPassword: 'WrongPassword999!',
        newPassword: 'BrandNewPass123!',
        confirmPassword: 'BrandNewPass123!'
      })
    });

    assert.equal(res.status, 401, 'Wrong password must return 401');
    const json = await res.json();
    assert.match(json.message, /incorrect current password/i);
  });

  await t.test('1.2 Change Password: weak new password (< 8 chars) rejected with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${primaryToken}`
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: 'short',
        confirmPassword: 'short'
      })
    });

    assert.equal(res.status, 400, 'Short password must return 400');
    const json = await res.json();
    assert.match(json.message, /at least 8 characters/i);
  });

  await t.test('1.3 Change Password: confirmation mismatch rejected with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${primaryToken}`
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: 'BrandNewPass123!',
        confirmPassword: 'MismatchPass456!'
      })
    });

    assert.equal(res.status, 400, 'Confirmation mismatch must return 400');
    const json = await res.json();
    assert.match(json.message, /passwords do not match/i);
  });

  await t.test('1.4 Change Password: new password identical to current rejected with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${primaryToken}`
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: initialPassword,
        confirmPassword: initialPassword
      })
    });

    assert.equal(res.status, 400, 'Same password must return 400');
    const json = await res.json();
    assert.match(json.message, /must be different/i);
  });

  await t.test('1.5 Change Password: successful change updates credentials and revokes other sessions', async () => {
    const newPass = 'BrandNewPass2026!';
    const res = await fetch(`${baseUrl}/api/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${primaryToken}`
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: newPass,
        confirmPassword: newPass
      })
    });

    assert.equal(res.status, 200, 'Password change must succeed');
    const json = await res.json();
    assert.match(json.message, /successfully/i);

    // Old password stops working
    const oldLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: testStudentId, password: initialPassword })
    });
    assert.equal(oldLoginRes.status, 401, 'Old password must be rejected');

    // New password works
    const newLoginRes = await fetch(`${baseUrl}/api/mobile/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: testStudentId, password: newPass })
    });
    assert.equal(newLoginRes.status, 200, 'New password must succeed on login');

    // Verify session/token revocation:
    // Secondary token must be revoked
    const secondaryCheck = await db.get('SELECT token FROM mobile_tokens WHERE token = ?', secondaryToken);
    assert.equal(secondaryCheck, null, 'Other mobile tokens must be revoked');

    // Primary token (caller) remains valid
    const primaryCheck = await db.get('SELECT token FROM mobile_tokens WHERE token = ?', primaryToken);
    assert.ok(primaryCheck, 'Current active caller token should remain valid');
  });

  // =========================================================================
  // SECTION 2: DOCUMENT READER FORMAT MATRIX TESTS
  // =========================================================================
  await t.test('2.1 Document reader format classification matrix and Office Preview API', async () => {
    // Office supported extensions
    assert.equal(officePreview.isOfficePreviewSupported('Lecture.pptx'), true, 'PPTX supported');
    assert.equal(officePreview.isOfficePreviewSupported('Deck.ppt'), true, 'PPT supported');
    assert.equal(officePreview.isOfficePreviewSupported('Notes.docx'), true, 'DOCX supported');
    assert.equal(officePreview.isOfficePreviewSupported('Document.doc'), true, 'DOC supported');
    assert.equal(officePreview.isOfficePreviewSupported('Spreadsheet.xlsx'), true, 'XLSX supported');
    assert.equal(officePreview.isOfficePreviewSupported('Sheet.xls'), true, 'XLS supported');

    // Non-office formats rejected for office-preview
    assert.equal(officePreview.isOfficePreviewSupported('Document.pdf'), false, 'PDF not in Office preview');
    assert.equal(officePreview.isOfficePreviewSupported('Data.txt'), false, 'TXT not in Office preview');
    assert.equal(officePreview.isOfficePreviewSupported('archive.zip'), false, 'ZIP not in Office preview');
    assert.equal(officePreview.isOfficePreviewSupported('script.sh'), false, 'Script not in Office preview');
  });

  // =========================================================================
  // SECTION 3 & 4: MULTI-FILE UPLOAD + MATERIAL NOTIFICATIONS
  // =========================================================================
  await t.test('3.1 Single file upload creates 1 DB record + persistent in-app notification + push outbox', async () => {
    const formData = new FormData();
    const pdfBlob = new Blob(['Sample PDF document content'], { type: 'application/pdf' });
    formData.append('files', pdfBlob, 'Algorithms_Unit1.pdf');
    formData.append('title', 'Algorithms Unit 1');
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Algorithms');
    formData.append('chapter', 'Unit 1: Sorting');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${primaryToken}` },
      body: formData,
    });

    assert.equal(res.status, 200, 'Upload should succeed');
    const json = await res.json();
    assert.equal(json.count, 1);
    const uploadedFileId = json.fileId;

    // Verify DB file persisted
    const dbFile = await db.get('SELECT id, title, semester, subject FROM files WHERE id = ?', uploadedFileId);
    assert.ok(dbFile, 'File must exist in DB');
    assert.equal(dbFile.title, 'Algorithms Unit 1');

    // Verify Persistent In-App Notification in `notifications` table
    const inAppNotif = await db.all(
      'SELECT id, recipientStudentId, type, relatedFileId, message, isRead FROM notifications WHERE recipientStudentId = ? AND relatedFileId = ?',
      otherStudentId, uploadedFileId
    );
    assert.ok(inAppNotif.length >= 1, 'In-app notification record must exist for targeted semester student');
    assert.equal(inAppNotif[0].type, 'material');
    assert.equal(inAppNotif[0].isRead, 0);

    // Verify push outbox row for targeted student
    const outboxRows = await db.all(
      "SELECT id, recipient_student_id, event_type, event_id, payload_json FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?",
      otherStudentId, String(uploadedFileId)
    );
    assert.equal(outboxRows.length, 1, 'Exactly 1 push job created for Sem 2 student');
    const payload = typeof outboxRows[0].payload_json === 'string' ? JSON.parse(outboxRows[0].payload_json) : outboxRows[0].payload_json;
    assert.equal(payload.data.type, 'material');
    assert.equal(payload.data.fileId, uploadedFileId);

    // Verify uploader is suppressed
    const uploaderNotif = await db.all('SELECT id FROM notifications WHERE recipientStudentId = ? AND relatedFileId = ?', testStudentId, uploadedFileId);
    assert.equal(uploaderNotif.length, 0, 'Uploader must not receive in-app notification');
    const uploaderOutbox = await db.all('SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?', testStudentId, String(uploadedFileId));
    assert.equal(uploaderOutbox.length, 0, 'Uploader must not receive push notification');

    // Verify other semester is excluded
    const sem4Notif = await db.all('SELECT id FROM notifications WHERE recipientStudentId = ? AND relatedFileId = ?', sem4StudentId, uploadedFileId);
    assert.equal(sem4Notif.length, 0, 'Unrelated semester student must not receive in-app notification');
  });

  await t.test('3.2 Multi-file batch upload (3 files) generates ONE logical batch notification', async () => {
    const batchId = `batch_three_${Date.now()}`;
    const formData = new FormData();

    const f1 = new Blob(['Word doc content'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const f2 = new Blob(['Excel sheet content'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const f3 = new Blob(['PowerPoint slides'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });

    formData.append('files', f1, 'Notes.docx');
    formData.append('files', f2, 'Grades.xlsx');
    formData.append('files', f3, 'Presentation.pptx');

    formData.append('fileTitles', JSON.stringify(['Word Notes', 'Excel Formulas', 'Slide Presentation']));
    formData.append('batchId', batchId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Algorithms');
    formData.append('chapter', 'Unit 2: Graphs');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${primaryToken}` },
      body: formData,
    });

    assert.equal(res.status, 200, 'Batch upload must succeed');
    const json = await res.json();
    assert.equal(json.count, 3, '3 files persisted');
    assert.equal(json.files.length, 3);

    // Verify ONE logical batch push notification enqueued (not 3 separate notifications)
    const outboxBatch = await db.all(
      "SELECT id, recipient_student_id, event_type, event_id, payload_json FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?",
      otherStudentId, batchId
    );
    assert.equal(outboxBatch.length, 1, 'Only ONE batch notification must be enqueued');
    const payload = typeof outboxBatch[0].payload_json === 'string' ? JSON.parse(outboxBatch[0].payload_json) : outboxBatch[0].payload_json;
    assert.equal(payload.data.type, 'material_batch');
    assert.equal(payload.data.materialCount, 3);
    assert.equal(payload.data.fileIds.length, 3);

    // Verify persistent in-app notification for the batch
    const inAppBatch = await db.all(
      "SELECT id, recipientStudentId, type, message FROM notifications WHERE recipientStudentId = ? AND type = 'material_batch'",
      otherStudentId
    );
    assert.ok(inAppBatch.length >= 1, 'Batch in-app notification must exist');
    assert.match(inAppBatch[inAppBatch.length - 1].message, /3 new study materials/i);
  });

  await t.test('3.3 Partial-success batch (2 succeed, 1 fails) persists succeeded files and notifies ONLY for successful count', async () => {
    const partialId = `batch_partial_test_${Date.now()}`;
    const formData = new FormData();

    const f1 = new Blob(['Good File 1'], { type: 'application/pdf' });
    const f2 = new Blob(['Good File 2'], { type: 'application/pdf' });
    const f3 = new Blob(['Corrupt File'], { type: 'application/pdf' });

    formData.append('files', f1, 'Good_1.pdf');
    formData.append('files', f2, 'Good_2.pdf');
    formData.append('files', f3, 'Corrupt__FAIL__.pdf'); // Triggers failure

    formData.append('fileTitles', JSON.stringify(['Good Note 1', 'Good Note 2', 'Corrupt Note']));
    formData.append('batchId', partialId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Algorithms');
    formData.append('chapter', 'Unit 3: DP');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${primaryToken}` },
      body: formData,
    });

    assert.equal(res.status, 207, 'Partial success must return HTTP 207 Multi-Status');
    const json = await res.json();
    assert.equal(json.isPartial, true);
    assert.equal(json.count, 2, '2 files succeeded');
    assert.equal(json.failedFiles.length, 1, '1 file failed');

    // Succeeded files stay in DB
    const db1 = await db.get('SELECT id FROM files WHERE id = ?', json.successfulFiles[0].id);
    const db2 = await db.get('SELECT id FROM files WHERE id = ?', json.successfulFiles[1].id);
    assert.ok(db1, 'Good 1 must stay in DB');
    assert.ok(db2, 'Good 2 must stay in DB');

    // Failed file not in DB
    const db3 = await db.get("SELECT id FROM files WHERE originalName = 'Corrupt__FAIL__.pdf'");
    assert.ok(!db3, 'Corrupt file must not be in DB');

    // Push notification MUST mention 2, NOT 3
    const outboxPartial = await db.all(
      "SELECT id, payload_json FROM push_notification_outbox WHERE recipient_student_id = ? AND event_id = ?",
      otherStudentId, partialId
    );
    assert.equal(outboxPartial.length, 1, 'Exactly 1 notification enqueued for partial success batch');
    const payload = typeof outboxPartial[0].payload_json === 'string' ? JSON.parse(outboxPartial[0].payload_json) : outboxPartial[0].payload_json;
    assert.equal(payload.data.materialCount, 2, 'Must state 2 materials, not 3');
    assert.deepEqual(payload.data.fileIds, [Number(json.successfulFiles[0].id), Number(json.successfulFiles[1].id)]);
  });

  await t.test('3.4 Failed batch produces 0 material notifications', async () => {
    const failedId = `batch_fail_${Date.now()}`;
    const formData = new FormData();

    const f1 = new Blob(['Fail 1'], { type: 'application/pdf' });
    const f2 = new Blob(['Fail 2'], { type: 'application/pdf' });

    formData.append('files', f1, 'File1__FAIL__.pdf');
    formData.append('files', f2, 'File2__FAIL__.pdf');
    formData.append('batchId', failedId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Algorithms');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${primaryToken}` },
      body: formData,
    });

    assert.equal(res.status, 500, 'When all files fail, status is 500');
    const json = await res.json();
    assert.equal(json.count, 0);

    // Verify ZERO notifications enqueued
    const outboxFail = await db.all(
      "SELECT id FROM push_notification_outbox WHERE event_id = ?",
      failedId
    );
    assert.equal(outboxFail.length, 0, 'Failed batch must produce ZERO notifications');
  });
});
