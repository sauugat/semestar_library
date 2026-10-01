/**
 * Physical Android Verification Suite for Semester Library Push Notifications.
 * Runs exact production event flows for Student 464676 (BIT Semester 3).
 * 
 * Supports the 10 real-device physical test scenarios:
 *   node scripts/physical-verification-suite.js normal-chat
 *   node scripts/physical-verification-suite.js long-chat
 *   node scripts/physical-verification-suite.js emoji-chat
 *   node scripts/physical-verification-suite.js rapid-chat
 *   node scripts/physical-verification-suite.js feed-post-title
 *   node scripts/physical-verification-suite.js feed-status
 *   node scripts/physical-verification-suite.js material
 *   node scripts/physical-verification-suite.js official-notice
 *   node scripts/physical-verification-suite.js hide-preview-on
 *   node scripts/physical-verification-suite.js hide-preview-off
 *   node scripts/physical-verification-suite.js check-device
 */

const db = require('../db');
const push = require('../lib/push-notifications');

const TARGET_STUDENT_ID = '464676'; // Physical device student

async function ensureSender(id, name, role = 'student', semester = 'Semester 3') {
  await db.initSchema();
  if (db.isPostgres) {
    await db.run(
      'INSERT INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?) ON CONFLICT (studentId) DO UPDATE SET name = EXCLUDED.name, semester = EXCLUDED.semester',
      id, name, role, semester, 'test_hash'
    );
  } else {
    await db.run(
      'INSERT OR REPLACE INTO students (studentId, name, role, semester, passwordHash) VALUES (?, ?, ?, ?, ?)',
      id, name, role, semester, 'test_hash'
    );
  }
}

async function verifyReceipt(ticketId) {
  if (!ticketId) return null;
  try {
    const res = await globalThis.fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [ticketId] })
    });
    const json = await res.json();
    return json?.data?.[ticketId] || null;
  } catch (err) {
    return { error: err.message };
  }
}

async function run() {
  const command = process.argv[2] || 'help';
  await db.initSchema();

  console.log(`\n======================================================`);
  console.log(`  Semester Library - Physical Verification Suite`);
  console.log(`  Command: ${command}`);
  console.log(`  Target Student: ${TARGET_STUDENT_ID}`);
  console.log(`======================================================\n`);

  if (command === 'check-device') {
    const tokens = await db.all('SELECT * FROM student_device_tokens WHERE student_id = ?', TARGET_STUDENT_ID);
    console.log(`Registered device tokens for ${TARGET_STUDENT_ID}:`, tokens.map(t => ({
      platform: t.platform,
      device_name: t.device_name,
      token: t.expo_push_token.substring(0, 18) + '...' + t.expo_push_token.slice(-6),
      updated_at: t.updated_at
    })));
    const prefs = await push.getNotificationPreferences(db, TARGET_STUDENT_ID);
    console.log(`Current preferences:`, prefs);
    return;
  }

  if (command === 'hide-preview-on') {
    await push.updateNotificationPreferences(db, TARGET_STUDENT_ID, { hideLockscreenPreview: true });
    console.log(`✅ [Privacy]: Set hideLockscreenPreview = TRUE for student ${TARGET_STUDENT_ID}`);
    const prefs = await push.getNotificationPreferences(db, TARGET_STUDENT_ID);
    console.log(`Updated preferences:`, prefs);
    return;
  }

  if (command === 'hide-preview-off') {
    await push.updateNotificationPreferences(db, TARGET_STUDENT_ID, { hideLockscreenPreview: false });
    console.log(`✅ [Privacy]: Set hideLockscreenPreview = FALSE for student ${TARGET_STUDENT_ID}`);
    const prefs = await push.getNotificationPreferences(db, TARGET_STUDENT_ID);
    console.log(`Updated preferences:`, prefs);
    return;
  }

  // 1. Normal Chat Message
  if (command === 'normal-chat' || command === 'single-chat') {
    const senderId = 'SENDER_AARAV';
    const senderName = 'Aarav Sharma';
    const messageText = 'Are we meeting in the library today?';
    await ensureSender(senderId, senderName, 'student', 'Semester 3');

    const res = await db.run(
      'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
      senderId, messageText, new Date().toISOString()
    );
    const messageId = res.lastInsertRowid;
    console.log(`💬 Inserted chat message ID ${messageId} from ${senderName}: "${messageText}"`);

    const enqueueResult = await push.enqueueChatPushWithThrottle(db, {
      messageId,
      senderStudentId: senderId,
      senderName,
      text: messageText
    });
    console.log(`💬 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'chat',
      eventId: messageId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 2. Long Chat Message (Clean Truncation)
  if (command === 'long-chat') {
    const senderId = 'SENDER_AARAV';
    const senderName = 'Aarav Sharma';
    const messageText = 'Hey everyone, just wanted to check if the DBMS notes for Unit 5 on Normalization, Functional Dependencies, and 3NF/BCNF decomposition are already uploaded to the library? Let me know so we can start practicing SQL queries.';
    await ensureSender(senderId, senderName, 'student', 'Semester 3');

    const res = await db.run(
      'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
      senderId, messageText, new Date().toISOString()
    );
    const messageId = res.lastInsertRowid;
    console.log(`💬 Inserted long chat message ID ${messageId} from ${senderName}`);

    const enqueueResult = await push.enqueueChatPushWithThrottle(db, {
      messageId,
      senderStudentId: senderId,
      senderName,
      text: messageText
    });
    console.log(`💬 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'chat',
      eventId: messageId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 3. Emoji Chat Message
  if (command === 'emoji-chat') {
    const senderId = 'SENDER_AARAV';
    const senderName = 'Aarav Sharma';
    const messageText = 'Study session at 3 PM! 📚💻 Bring your laptops! 🚀🔥';
    await ensureSender(senderId, senderName, 'student', 'Semester 3');

    const res = await db.run(
      'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
      senderId, messageText, new Date().toISOString()
    );
    const messageId = res.lastInsertRowid;
    console.log(`💬 Inserted emoji chat message ID ${messageId} from ${senderName}: "${messageText}"`);

    const enqueueResult = await push.enqueueChatPushWithThrottle(db, {
      messageId,
      senderStudentId: senderId,
      senderName,
      text: messageText
    });
    console.log(`💬 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'chat',
      eventId: messageId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 4. 5 Rapid Messages (Coalescing with Latest Preview)
  if (command === 'rapid-chat') {
    const senderId = 'SENDER_AARAV';
    const senderName = 'Aarav Sharma';
    await ensureSender(senderId, senderName, 'student', 'Semester 3');

    const rapidTexts = [
      'Hey guys',
      'Are you free this afternoon?',
      'Let me know when you reach campus',
      'I grabbed a table on the 2nd floor',
      "I'll be at the library at 2 PM"
    ];

    console.log(`💬 Sending 5 rapid chat messages from ${senderName} within coalescing window...`);
    let lastMessageId = null;
    for (let i = 0; i < rapidTexts.length; i++) {
      const text = rapidTexts[i];
      const res = await db.run(
        'INSERT INTO chat_messages (studentId, text, createdAt) VALUES (?, ?, ?)',
        senderId, text, new Date().toISOString()
      );
      const messageId = res.lastInsertRowid;
      lastMessageId = messageId;

      const enqueueRes = await push.enqueueChatPushWithThrottle(db, {
        messageId,
        senderStudentId: senderId,
        senderName,
        text
      });
      console.log(`  Message #${i + 1} (ID ${messageId}): "${text}" -> enqueue:`, enqueueRes);
      await new Promise(r => setTimeout(r, 350));
    }

    console.log(`🚀 Dispatching outbox for coalesced messages (event ID ${lastMessageId})...`);
    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'chat',
      eventId: lastMessageId
    });
    console.log(`🚀 Coalesced dispatch result:`, dispatchResult);
    return;
  }

  // 5. Feed Post with Title
  if (command === 'feed-post-title') {
    const authorId = 'SENDER_AARAV';
    const authorName = 'Aarav Sharma';
    await ensureSender(authorId, authorName, 'student', 'Semester 3');

    const postTitle = 'Project Presentation Schedule';
    const postContent = 'The schedule for BIT Semester 3 project presentations has been finalized. Check the notice board for time slots.';
    const postRes = await db.run(
      'INSERT INTO posts (user_id, content, created_at, likes_count, comments_count, is_official, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      authorId, postContent, new Date().toISOString(), 0, 0, 0, 'status'
    );
    const postId = postRes.lastInsertRowid;
    console.log(`📝 Inserted feed post with title ID ${postId} by ${authorName}: "${postTitle}"`);

    const enqueueResult = await push.enqueuePostOrNoticePush(db, {
      postId,
      authorStudentId: authorId,
      authorName,
      type: 'post',
      isOfficial: false,
      role: 'student',
      title: postTitle,
      content: postContent,
      semester: 'Semester 3'
    });
    console.log(`📝 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'post',
      eventId: postId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 6. Feed Status without Title
  if (command === 'feed-status') {
    const authorId = 'SENDER_AARAV';
    const authorName = 'Aarav Sharma';
    await ensureSender(authorId, authorName, 'student', 'Semester 3');

    const statusContent = 'Does anyone have the DBMS Unit 4 notes?';
    const postRes = await db.run(
      'INSERT INTO posts (user_id, content, created_at, likes_count, comments_count, is_official, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      authorId, statusContent, new Date().toISOString(), 0, 0, 0, 'status'
    );
    const postId = postRes.lastInsertRowid;
    console.log(`📝 Inserted feed status ID ${postId} by ${authorName}: "${statusContent}"`);

    const enqueueResult = await push.enqueuePostOrNoticePush(db, {
      postId,
      authorStudentId: authorId,
      authorName,
      type: 'post',
      isOfficial: false,
      role: 'student',
      title: null,
      content: statusContent,
      semester: 'Semester 3'
    });
    console.log(`📝 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'post',
      eventId: postId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 7. Study Material Upload
  if (command === 'material') {
    const uploaderId = 'TEACHER_SHARMA';
    const uploaderName = 'Mr. Sharma';
    await ensureSender(uploaderId, uploaderName, 'teacher', 'Semester 3');

    const subject = 'Database Management Systems';
    const title = 'Unit 5: Normalization and SQL';
    const semester = 'Semester 3';

    const fileRes = await db.run(
      'INSERT INTO files (storedName, originalName, title, semester, subject, chapter, uploadedBy, sizeBytes, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `dbms_unit5_${Date.now()}.pdf`, 'DBMS_Unit5_Notes.pdf', title, semester, subject, 'Unit 5', uploaderId, 20480, new Date().toISOString()
    );
    const fileId = fileRes.lastInsertRowid;
    console.log(`📚 Inserted study material ID ${fileId}: "${title}" by ${uploaderName}`);

    const enqueueResult = await push.enqueueMaterialPush(db, {
      fileId,
      originalName: 'DBMS_Unit5_Notes.pdf',
      title,
      semester,
      subject,
      uploaderStudentId: uploaderId,
      uploaderName
    });
    console.log(`📚 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'material',
      eventId: fileId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  // 8. Official Notice
  if (command === 'official-notice') {
    const adminId = 'ADMIN_EXAM_CELL';
    const adminName = 'Administration';
    await ensureSender(adminId, adminName, 'admin', 'Semester 3');

    const noticeContent = 'Semester 3 final examination routine has been published. Practical exams commence from next Monday.';
    const noticeRes = await db.run(
      'INSERT INTO posts (user_id, content, created_at, likes_count, comments_count, is_official, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      adminId, noticeContent, new Date().toISOString(), 0, 0, 1, 'notice'
    );
    const noticeId = noticeRes.lastInsertRowid;
    console.log(`📢 Inserted official notice ID ${noticeId}: "${noticeContent}"`);

    const enqueueResult = await push.enqueuePostOrNoticePush(db, {
      postId: noticeId,
      authorStudentId: adminId,
      authorName: adminName,
      type: 'notice',
      isOfficial: true,
      role: 'admin',
      content: noticeContent,
      semester: 'Semester 3'
    });
    console.log(`📢 Enqueue result:`, enqueueResult);

    const dispatchResult = await push.dispatchImmediateOutbox(db, {
      eventType: 'notice',
      eventId: noticeId
    });
    console.log(`🚀 Dispatch result:`, dispatchResult);
    return;
  }

  console.log(`Available commands:
  - normal-chat
  - long-chat
  - emoji-chat
  - rapid-chat
  - feed-post-title
  - feed-status
  - material
  - official-notice
  - hide-preview-on
  - hide-preview-off
  - check-device
`);
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('[Error in verification runner]:', err);
  process.exit(1);
});
