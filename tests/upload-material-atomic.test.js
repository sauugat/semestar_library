const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../server');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Atomic Material Upload & Batch Notification Semantics', async (t) => {
  // Disable immediate synchronous dispatch to verify raw enqueued outbox states
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
  const teacherId = `TEACHER_${ts}`;
  const studentS2Id = `STUDENT_S2_${ts}`;
  const studentS4Id = `STUDENT_S4_${ts}`;

  // Clean outbox for these test accounts
  await db.run("DELETE FROM push_notification_outbox WHERE recipient_student_id LIKE 'STUDENT_%' OR recipient_student_id LIKE 'TEACHER_%'");

  // Insert teacher and students
  for (const s of [
    { id: teacherId, name: 'Prof. Sharma', role: 'teacher', semester: 'Semester 2' },
    { id: studentS2Id, name: 'Student Sem 2', role: 'student', semester: 'Semester 2' },
    { id: studentS4Id, name: 'Student Sem 4', role: 'student', semester: 'Semester 4' },
  ]) {
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        s.id, s.name, s.role, s.semester, 'test_hash'
      );
    } else {
      await db.run(
        'INSERT OR IGNORE INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?)',
        s.id, s.name, s.role, s.semester, 'test_hash'
      );
    }
  }

  // Issue mobile bearer tokens
  const teacherToken = `tok_${teacherId}_${ts}`;
  const studentToken = `tok_${studentS2Id}_${ts}`;
  const expiresAt = new Date(Date.now() + 86400000).toISOString();

  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', teacherToken, teacherId, new Date().toISOString(), expiresAt);
  await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)', studentToken, studentS2Id, new Date().toISOString(), expiresAt);
  await db.run('INSERT INTO student_device_tokens (student_id, expo_push_token, platform, device_name, updated_at) VALUES (?, ?, ?, ?, ?)', studentS2Id, `ExponentPushToken[sem2_test_${ts}]`, 'android', 'Pixel 8', new Date().toISOString());


  // -------------------------------------------------------------
  // Test 1: Empty upload -> 400 Bad Request, 0 DB records, 0 notifications
  // -------------------------------------------------------------
  await t.test('1. Empty upload produces 0 DB records and 0 push notifications', async () => {
    const formData = new FormData();
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 400, 'Empty upload should fail with HTTP 400');
    const json = await res.json();
    assert.ok(json.message.includes('No file was uploaded'));

    const outbox = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ?",
      studentS2Id
    );
    assert.equal(outbox.length, 0, 'No notification should be created when no files are uploaded');
  });

  // -------------------------------------------------------------
  // Test 2: Single file upload -> exactly 1 material push notification
  // -------------------------------------------------------------
  await t.test('2. Single file upload creates 1 DB record and exactly 1 material notification', async () => {
    const formData = new FormData();
    const blob = new Blob(['Dummy PDF Content for Test 2'], { type: 'application/pdf' });
    formData.append('files', blob, 'Single_Note_Ch1.pdf');
    formData.append('title', 'Unit 1 Overview');
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');
    formData.append('chapter', 'Unit 1: Intro');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 200, 'Upload should succeed');
    const json = await res.json();
    assert.equal(json.count, 1);
    assert.ok(json.fileId);

    // Verify 1 notification row for studentS2Id
    const outbox = await db.all(
      "SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, String(json.fileId)
    );
    assert.equal(outbox.length, 1, 'Should create 1 notification row for Semester 2 student');

    const payload = typeof outbox[0].payload_json === 'string' ? JSON.parse(outbox[0].payload_json) : outbox[0].payload_json;
    assert.equal(payload.data.type, 'material');
    assert.equal(payload.data.fileId, json.fileId);

    // Verify uploader did not receive push
    const uploaderOutbox = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      teacherId, String(json.fileId)
    );
    assert.equal(uploaderOutbox.length, 0, 'Teacher uploader must not receive notification');
  });

  // -------------------------------------------------------------
  // Test 3: Multi-file batch upload (3 files) -> ONE batch notification, not 3
  // -------------------------------------------------------------
  await t.test('3. Multi-file batch upload persists 3 files and creates ONE batch notification', async () => {
    const batchId = `batch_${Date.now()}_abc123`;
    const formData = new FormData();

    const blob1 = new Blob(['PDF Content 1'], { type: 'application/pdf' });
    const blob2 = new Blob(['PDF Content 2'], { type: 'application/pdf' });
    const blob3 = new Blob(['PPTX Content 3'], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });

    formData.append('files', blob1, 'DBMS_Unit4.pdf');
    formData.append('files', blob2, 'DBMS_Unit5.pdf');
    formData.append('files', blob3, 'Normalization_Slides.pptx');

    formData.append('fileTitles', JSON.stringify(['DBMS Unit 4', 'DBMS Unit 5', 'Normalization Slides']));
    formData.append('batchId', batchId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');
    formData.append('chapter', 'Unit 4: Normalization');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    assert.equal(res.status, 200, 'Batch upload should succeed');
    const json = await res.json();
    assert.equal(json.count, 3, 'Should have persisted 3 files');
    assert.equal(json.files.length, 3);

    // Verify DB records have individual clean titles
    assert.equal(json.files[0].title, 'DBMS Unit 4');
    assert.equal(json.files[1].title, 'DBMS Unit 5');
    assert.equal(json.files[2].title, 'Normalization Slides');

    // Verify studentS2Id received exactly ONE batch notification for the entire batch
    const outboxRows = await db.all(
      "SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, batchId
    );
    assert.equal(outboxRows.length, 1, 'Teacher multi-file upload must create ONE batch notification, not 3 pushes');

    const batchPayload = typeof outboxRows[0].payload_json === 'string'
      ? JSON.parse(outboxRows[0].payload_json)
      : outboxRows[0].payload_json;

    assert.equal(batchPayload.data.type, 'material_batch');
    assert.equal(batchPayload.data.batchId, batchId);
    assert.equal(batchPayload.data.materialCount, 3);
    assert.deepEqual(batchPayload.data.fileIds, json.files.map(f => Number(f.id)));
    assert.equal(outboxRows[0].idempotency_key, `material-batch:${batchId}:${studentS2Id}`);

    // Verify uploader is excluded
    const uploaderRows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      teacherId, batchId
    );
    assert.equal(uploaderRows.length, 0, 'Uploader must not receive batch notification');

    // Verify other semester (Semester 4) student is excluded
    const s4Rows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS4Id, batchId
    );
    assert.equal(s4Rows.length, 0, 'Semester 4 student must not receive Semester 2 batch notification');
  });

  // -------------------------------------------------------------
  // Test 4: Idempotent batch retry -> zero duplicate push outbox entries
  // -------------------------------------------------------------
  await t.test('4. Duplicate batch enqueue with same batchId does not duplicate outbox entries', async () => {
    const testBatchId = `retry_batch_${Date.now()}`;
    const files = [
      { id: 9001, originalName: 'A.pdf', title: 'A' },
      { id: 9002, originalName: 'B.pdf', title: 'B' }
    ];

    const first = await push.enqueueMaterialBatchPush(db, {
      batchId: testBatchId,
      files,
      semester: 'Semester 2',
      subject: 'Database Systems',
      chapter: 'Unit 1',
      uploaderStudentId: teacherId
    });
    assert.ok(first.enqueuedCount >= 1);

    const retry = await push.enqueueMaterialBatchPush(db, {
      batchId: testBatchId,
      files,
      semester: 'Semester 2',
      subject: 'Database Systems',
      chapter: 'Unit 1',
      uploaderStudentId: teacherId
    });

    const rows = await db.all(
      "SELECT id FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
      studentS2Id, testBatchId
    );
    assert.equal(rows.length, 1, 'Retry with same batchId must not create duplicate notifications');
  });

  // -------------------------------------------------------------
  // Test 5: Option B Partial Success Verification:
  // Batch of 3 files: file 1 & 2 succeed, file 3 intentionally fails
  // -------------------------------------------------------------
  await t.test('5. Partial success (Option B): 2 files succeed, 1 fails -> notification references ONLY 2 successful files, failed file reported with retry', async () => {
    const partialBatchId = `batch_partial_${Date.now()}`;
    const formData = new FormData();

    const blob1 = new Blob(['File 1 content'], { type: 'application/pdf' });
    const blob2 = new Blob(['File 2 content'], { type: 'application/pdf' });
    const blob3 = new Blob(['File 3 content with error'], { type: 'application/pdf' });

    formData.append('files', blob1, 'Success_Note_1.pdf');
    formData.append('files', blob2, 'Success_Note_2.pdf');
    formData.append('files', blob3, 'Corrupt_File__FAIL__.pdf'); // Triggers intentional failure

    formData.append('fileTitles', JSON.stringify(['Success Note 1', 'Success Note 2', 'Corrupt File']));
    formData.append('batchId', partialBatchId);
    formData.append('semester', 'Semester 2');
    formData.append('subject', 'Database Systems');
    formData.append('chapter', 'Unit 5: Transactions');

    const res = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
      },
      body: formData,
    });

    try {
      // Should return HTTP 207 Multi-Status
      assert.equal(res.status, 207, 'Partial success returns HTTP 207 Multi-Status');
      const json = await res.json();

      assert.equal(json.isPartial, true);
      assert.equal(json.batchId, partialBatchId);
      assert.equal(json.message, '2 of 3 files uploaded successfully');
      assert.equal(json.count, 2, '2 files succeeded');
      assert.equal(json.total, 3, '3 files total');

      // Structured per-file results
      assert.ok(Array.isArray(json.successfulFiles), 'successfulFiles array present');
      assert.equal(json.successfulFiles.length, 2, '2 files in successfulFiles');
      assert.equal(json.successfulFiles[0].title, 'Success Note 1');
      assert.equal(json.successfulFiles[1].title, 'Success Note 2');

      assert.ok(Array.isArray(json.failedFiles), 'failedFiles array present');
      assert.equal(json.failedFiles.length, 1, '1 file in failedFiles');
      assert.equal(json.failedFiles[0].name, 'Corrupt_File__FAIL__.pdf');
      assert.ok(json.failedFiles[0].error, 'Error message present for failed file');

      // Verify DB: files 1 and 2 persist in database
      const dbFile1 = await db.get('SELECT id, title FROM files WHERE id = ?', json.successfulFiles[0].id);
      const dbFile2 = await db.get('SELECT id, title FROM files WHERE id = ?', json.successfulFiles[1].id);
      assert.ok(dbFile1, 'File 1 exists in DB');
      assert.ok(dbFile2, 'File 2 exists in DB');

      // Verify DB: failed file 3 does NOT exist in files table
      const dbFile3 = await db.get("SELECT id FROM files WHERE originalName = 'Corrupt_File__FAIL__.pdf'");
      assert.ok(!dbFile3, 'Failed file 3 must not exist in DB');

      // Verify notification: exactly ONE batch push event enqueued for Semester 2 student
      const outboxRows = await db.all(
        "SELECT id, payload_json, idempotency_key FROM push_notification_outbox WHERE recipient_student_id = ? AND event_type = 'material' AND event_id = ?",
        studentS2Id, partialBatchId
      );
      assert.equal(outboxRows.length, 1, 'Exactly 1 batch notification created for partial success');

      const batchPayload = typeof outboxRows[0].payload_json === 'string'
        ? JSON.parse(outboxRows[0].payload_json)
        : outboxRows[0].payload_json;

      // Push notification MUST reference ONLY the 2 successful files, NEVER the failed file!
      assert.equal(batchPayload.data.materialCount, 2, 'Notification must state 2 files, not 3');
      assert.deepEqual(
        batchPayload.data.fileIds,
        [Number(json.successfulFiles[0].id), Number(json.successfulFiles[1].id)],
        'Notification must reference only the 2 successful file IDs'
      );
      assert.ok(
        batchPayload.body.includes('2 new files') || batchPayload.body.includes('2 new study materials'),
        'Body must mention 2 new files'
      );
      assert.equal(outboxRows[0].idempotency_key, `material-batch:${partialBatchId}:${studentS2Id}`);
    } catch (test5Err) {
      console.error('TEST 5 DETAILED ERROR:', test5Err);
      throw test5Err;
    }
  });
});

