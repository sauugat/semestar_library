const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const push = require('../lib/push-notifications');

test('Chat Mention Migration & Old Row Compatibility Suite', async (t) => {
  await db.initSchema();

  await t.test('MIG1: Schema migration adds handle column idempotently to legacy table without data loss', async () => {
    // 1. Create legacy table WITHOUT handle column
    await db.exec('DROP TABLE IF EXISTS test_legacy_mentions');
    if (db.isPostgres) {
      await db.exec(`
        CREATE TABLE test_legacy_mentions (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL,
          mentioned_student_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, mentioned_student_id)
        );
        CREATE INDEX idx_test_leg_msg ON test_legacy_mentions(message_id);
        CREATE INDEX idx_test_leg_stu ON test_legacy_mentions(mentioned_student_id);
      `);
    } else {
      await db.exec(`
        CREATE TABLE test_legacy_mentions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL,
          mentioned_student_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(message_id, mentioned_student_id)
        );
        CREATE INDEX idx_test_leg_msg ON test_legacy_mentions(message_id);
        CREATE INDEX idx_test_leg_stu ON test_legacy_mentions(mentioned_student_id);
      `);
    }

    // 2. Insert legacy rows before migration
    await db.run(
      'INSERT INTO test_legacy_mentions (message_id, mentioned_student_id) VALUES (?, ?)',
      1001, 'student_legacy_1'
    );
    await db.run(
      'INSERT INTO test_legacy_mentions (message_id, mentioned_student_id) VALUES (?, ?)',
      1001, 'student_legacy_2'
    );

    // Helper to run migration logic
    async function runMigration() {
      if (db.isPostgres) {
        await db.exec('ALTER TABLE test_legacy_mentions ADD COLUMN IF NOT EXISTS handle TEXT');
      } else {
        try {
          await db.exec('ALTER TABLE test_legacy_mentions ADD COLUMN handle TEXT');
        } catch (err) {
          const msg = (err?.message || '').toLowerCase();
          if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
            throw err;
          }
        }
      }
    }

    // 3. Run migration first time
    await runMigration();

    // 4. Verify existing rows remain intact and handle is NULL
    const rows = await db.all('SELECT message_id, mentioned_student_id, handle FROM test_legacy_mentions WHERE message_id = 1001 ORDER BY id ASC');
    assert.equal(rows.length, 2, 'Existing mention rows must be preserved');
    assert.equal(rows[0].mentionedStudentId || rows[0].mentioned_student_id, 'student_legacy_1');
    assert.equal(rows[0].handle, null, 'Legacy rows have null handle initially');
    assert.equal(rows[1].mentionedStudentId || rows[1].mentioned_student_id, 'student_legacy_2');
    assert.equal(rows[1].handle, null);

    // 5. Run migration a SECOND time to verify idempotency
    await runMigration();

    // 6. Verify inserting new row with handle succeeds
    await db.run(
      'INSERT INTO test_legacy_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)',
      1002, 'student_new', 'alice_handle'
    );
    const newRow = await db.get('SELECT message_id, mentioned_student_id, handle FROM test_legacy_mentions WHERE message_id = 1002');
    assert.equal(newRow.handle, 'alice_handle');

    // 7. Verify UNIQUE constraint (message_id, mentioned_student_id) remains enforced
    let threwUnique = false;
    try {
      await db.run(
        'INSERT INTO test_legacy_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, ?)',
        1001, 'student_legacy_1', 'duplicate_mention'
      );
    } catch (err) {
      threwUnique = true;
    }
    assert.ok(threwUnique, 'UNIQUE (message_id, mentioned_student_id) constraint must remain valid');

    // 8. Verify live ensurePushNotificationSchema can be executed twice safely
    await push.ensurePushNotificationSchema(db);
    await push.ensurePushNotificationSchema(db);

    // Clean up test table
    await db.exec('DROP TABLE IF EXISTS test_legacy_mentions');
  });

  await t.test('COMPAT1: Old mention rows with handle = NULL resolve safely without crashing or rendering @undefined', async () => {
    const http = require('http');
    const app = require('../server');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const ts = Date.now();
    const senderId = `SENDER_COMPAT_${ts}`;
    const targetStudentId = `TARGET_COMPAT_${ts}`;
    const targetUsername = `target_user_${ts}`;

    // Seed students
    await db.run('INSERT INTO students (studentId, name, username, department, role, passwordHash) VALUES (?, ?, ?, ?, ?, ?)',
      senderId, 'Sender Compat', `sender_${ts}`, 'BIT', 'student', 'test_hash');
    await db.run('INSERT INTO students (studentId, name, username, department, role, passwordHash) VALUES (?, ?, ?, ?, ?, ?)',
      targetStudentId, 'Target Student', targetUsername, 'BIT', 'student', 'test_hash');

    const token = `tok_compat_${ts}`;
    await db.run('INSERT INTO mobile_tokens (token, studentId, createdAt, expiresAt) VALUES (?, ?, ?, ?)',
      token, senderId, new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());

    // 1. Insert chat message
    const msgRes = await db.run(
      'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
      senderId, `Hey @${targetUsername} check this legacy mention`, new Date().toISOString()
    );
    const msgId = msgRes.lastInsertRowid;

    // 2. Insert legacy mention row directly with handle = NULL
    if (db.isPostgres) {
      await db.run(
        'INSERT INTO chat_message_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, NULL)',
        msgId, targetStudentId
      );
    } else {
      await db.run(
        'INSERT INTO chat_message_mentions (message_id, mentioned_student_id, handle) VALUES (?, ?, NULL)',
        msgId, targetStudentId
      );
    }

    // Verify row has NULL handle in database
    const rawRow = await db.get('SELECT handle FROM chat_message_mentions WHERE message_id = ? AND mentioned_student_id = ?', msgId, targetStudentId);
    assert.equal(rawRow.handle, null, 'Raw row has NULL handle');

    // 3. Request messages via API
    const res = await fetch(`${baseUrl}/api/chat/messages?limit=20`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const foundMsg = data.messages.find(m => m.id === msgId);
    assert.ok(foundMsg, 'Message must be found');

    // 4. Verify mentions and mentionsDetail tolerates handle = NULL gracefully
    assert.ok(Array.isArray(foundMsg.mentions));
    assert.ok(foundMsg.mentions.includes(targetStudentId), 'Structured studentId must remain authoritative');

    assert.ok(Array.isArray(foundMsg.mentionsDetail));
    assert.equal(foundMsg.mentionsDetail.length, 1);
    const detail = foundMsg.mentionsDetail[0];
    assert.equal(detail.studentId, targetStudentId, 'Authoritative studentId matches');
    assert.equal(detail.handle, targetUsername, 'Null handle safely resolved to current student username');
    assert.notEqual(detail.handle, 'undefined');
    assert.notEqual(detail.handle, '@undefined');
    assert.notEqual(detail.handle, null);

    // Cleanup
    await db.run('DELETE FROM chat_message_mentions WHERE message_id = ?', msgId);
    await db.run('DELETE FROM chat_messages WHERE id = ?', msgId);
    await db.run('DELETE FROM mobile_tokens WHERE studentId = ?', senderId);
    await db.run('DELETE FROM students WHERE studentId IN (?, ?)', senderId, targetStudentId);
    server.close();
  });

  t.after(() => {
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
});
