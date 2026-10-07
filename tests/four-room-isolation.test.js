'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { fixture } = require('./helpers/cohort-fixture');
const cohortChatRouter = require('../routes/cohort-chat');

async function createServer(f) {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', async (req, res, next) => {
    const auth = req.get('authorization') || '';
    const match = /^Bearer fixture-([a-z0-9]+)$/.exec(auth);
    if (!match) return res.status(401).json({ message: 'Authentication required.' });
    const student = await f.db.get('SELECT studentId, role FROM students WHERE studentId=?', match[1]);
    if (!student) return res.status(401).json({ message: 'Authentication required.' });
    req.student = student;
    next();
  }, cohortChatRouter(f.service));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const request = async (method, path, body, studentId = 'm1', file = null) => {
    const headers = studentId ? { authorization: `Bearer fixture-${studentId}` } : {};
    let requestBody;
    if (file) {
      const form = new FormData();
      if (body) {
        for (const [key, val] of Object.entries(body)) {
          form.append(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
        }
      }
      form.append('attachment', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
      requestBody = form;
    } else if (body) {
      headers['content-type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat${path}`, {
      method,
      headers,
      body: requestBody
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, headers: response.headers, body: parsed };
  };

  return { server, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test('Section 27: Four fixed rooms isolation and security verification', async t => {
  const f = await fixture('sqlite');
  t.after(f.close);
  const rooms = await f.seed();
  for (const room of Object.values(rooms)) {
    await f.service.syncProjection(room.chatGroupId);
  }
  const srv = await createServer(f);
  t.after(srv.close);

  // 1. Mercury student M (m1), Venus student V (v1), Earth student E (e1), Mars student R (s1)
  const students = {
    M: { id: 'm1', code: 'MERCURY', semester: 1 },
    V: { id: 'v1', code: 'VENUS', semester: 3 },
    E: { id: 'e1', code: 'EARTH', semester: 5 },
    R: { id: 's1', code: 'MARS', semester: 7 },
  };

  // Verify GET /api/chat/config returns own unique chatGroupId and expected shape
  const configs = {};
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('GET', '/config', null, student.id);
    assert.equal(res.status, 200, `Config request for ${student.id} must be 200`);
    assert.equal(res.body.groupCode, student.code);
    assert.equal(res.body.currentSemester, student.semester);
    assert.equal(typeof res.body.chatGroupId, 'string');
    assert.equal(typeof res.body.realtimeEpoch, 'number');
    assert.equal(typeof res.body.cohortDisplayName, 'string');
    assert.equal(res.body.permissions.canPost, true);
    configs[key] = res.body;
  }

  // Ensure all 4 chatGroupIds are unique
  const groupIds = Object.values(configs).map(c => c.chatGroupId);
  assert.equal(new Set(groupIds).size, 4, 'All 4 cohorts must have unique chatGroupId');

  // Verify realtime-config shape
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('GET', '/realtime-config', null, student.id);
    assert.equal(res.status, 200, `Realtime-config request for ${student.id} must be 200`);
    assert.equal(res.body.chatGroupId, configs[key].chatGroupId);
    assert.equal(res.body.topic, `chat:${configs[key].chatGroupId}:${configs[key].realtimeEpoch}`);
    assert.equal(typeof res.body.token, 'string');
  }

  // Send one message from each student
  const messages = {};
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('POST', '/messages', {
      clientId: `client-${key}-${randomUUID()}`,
      text: `Hello from ${student.code} student ${student.id}`
    }, student.id);
    assert.equal(res.status, 200, `Send message from ${student.id} must succeed`);
    assert.equal(res.body.duplicate, false);
    assert.equal(res.body.data.text, `Hello from ${student.code} student ${student.id}`);
    assert.equal(res.body.data.chatGroupId, configs[key].chatGroupId);
    messages[key] = res.body.data;
  }

  // Verify message history isolation: each sees ONLY their own cohort message
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('GET', '/messages', null, student.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.chatGroupId, configs[key].chatGroupId);
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages[0].id, messages[key].id);
    assert.equal(res.body.messages[0].text, `Hello from ${student.code} student ${student.id}`);
    assert.equal(res.body.messages[0].studentId, student.id);
  }

  // Verify members endpoint for each cohort: only own cohort roster returned
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('GET', '/members', null, student.id);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    const memberIds = res.body.map(m => m.studentId);
    assert.ok(memberIds.includes(student.id), `Own cohort member list must contain ${student.id}`);
    if (student.id === 'm1') {
      assert.ok(!memberIds.includes('v1'));
      assert.ok(!memberIds.includes('e1'));
      assert.ok(!memberIds.includes('s1'));
    }
  }

  // Verify heartbeat endpoint for each cohort: sets online status
  for (const [key, student] of Object.entries(students)) {
    const res = await srv.request('POST', '/heartbeat', {}, student.id);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.total, 'number');
    assert.ok(Array.isArray(res.body.onlineIds));
    assert.ok(res.body.onlineIds.includes(student.id));
  }


  // Send a message with an attachment in Venus (v1)
  const venusAttachmentFile = {
    buffer: Buffer.from('secret venus notes'),
    originalname: 'venus-lecture.pdf',
    mimetype: 'application/pdf'
  };
  const vMsgWithFileRes = await srv.request('POST', '/messages', {
    clientId: `client-v-file-${randomUUID()}`,
    text: 'Venus secret file'
  }, 'v1', venusAttachmentFile);
  assert.equal(vMsgWithFileRes.status, 200);
  const venusAttachmentName = vMsgWithFileRes.body.data.attachmentName;
  assert.ok(venusAttachmentName);

  // Cross-Room Attack Matrix: Mercury student (m1) attempts to access Venus resources
  const venusGroupId = configs.V.chatGroupId;
  const venusMsgId = messages.V.id;

  // 1. Cross-room config with ?chatGroupId
  const attackConfig1 = await srv.request('GET', `/config?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackConfig1.status, 404, 'Must reject cross-room chatGroupId');

  // 2. Cross-room config with ?groupCode
  const attackConfig2 = await srv.request('GET', '/config?groupCode=VENUS', null, 'm1');
  assert.equal(attackConfig2.status, 404, 'Must reject cross-room groupCode');

  // 3. Cross-room messages with ?chatGroupId
  const attackMessages1 = await srv.request('GET', `/messages?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackMessages1.status, 404, 'Must reject cross-room history with chatGroupId');

  // 4. Cross-room messages with ?groupCode
  const attackMessages2 = await srv.request('GET', '/messages?groupCode=VENUS', null, 'm1');
  assert.equal(attackMessages2.status, 404, 'Must reject cross-room history with groupCode');

  // 5. Cross-room exact message
  const attackExact = await srv.request('GET', `/groups/${venusGroupId}/messages/${venusMsgId}`, null, 'm1');
  assert.equal(attackExact.status, 404, 'Must reject cross-room exact message');

  // 6. Cross-room send
  const attackSend = await srv.request('POST', '/messages', {
    chatGroupId: venusGroupId,
    clientId: randomUUID(),
    text: 'Intruder text'
  }, 'm1');
  assert.equal(attackSend.status, 404, 'Must reject cross-room send');

  // 7. Cross-room reaction
  const attackReaction = await srv.request('POST', '/reactions', {
    messageId: venusMsgId,
    emoji: '👍'
  }, 'm1');
  assert.equal(attackReaction.status, 404, 'Must reject reaction on cross-room message');

  // 8. Cross-room delete
  const attackDelete = await srv.request('DELETE', `/messages/${venusMsgId}`, null, 'm1');
  assert.equal(attackDelete.status, 404, 'Must reject deleting cross-room message');

  // 9. Cross-room read receipt
  const attackRead = await srv.request('POST', '/read', {
    lastReadMessageId: venusMsgId
  }, 'm1');
  assert.equal(attackRead.status, 404, 'Must reject read receipt on cross-room message');

  // 10. Cross-room typing
  const attackTyping = await srv.request('POST', '/typing', {
    chatGroupId: venusGroupId
  }, 'm1');
  assert.equal(attackTyping.status, 404, 'Must reject cross-room typing');

  // 11. Cross-room heartbeat
  const attackHeartbeat = await srv.request('POST', '/heartbeat', {
    chatGroupId: venusGroupId
  }, 'm1');
  assert.equal(attackHeartbeat.status, 404, 'Must reject cross-room heartbeat');

  // 12. Cross-room members
  const attackMembers = await srv.request('GET', `/members?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackMembers.status, 404, 'Must reject cross-room members');

  // 13. Cross-room mention candidates
  const attackMentions = await srv.request('GET', `/mentions/students?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackMentions.status, 404, 'Must reject cross-room mention candidates');

  // 14. Cross-room pinned
  const attackPinned = await srv.request('GET', `/pinned?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackPinned.status, 404, 'Must reject cross-room pinned');

  // 15. Cross-room pin action
  const attackPinAction = await srv.request('POST', `/pinned/${venusMsgId}`, null, 'm1');
  assert.equal(attackPinAction.status, 404, 'Must reject pinning cross-room message');

  // 16. Cross-room realtime-config
  const attackRtConfig = await srv.request('GET', `/realtime-config?chatGroupId=${venusGroupId}`, null, 'm1');
  assert.equal(attackRtConfig.status, 404, 'Must reject cross-room realtime-config');

  // 17. Section 19: Cross-room attachment access
  // Mercury student M tries to fetch Venus attachment by exact filename
  const attackAttachment = await srv.request('GET', `/attachment/${venusAttachmentName}`, null, 'm1');
  assert.equal(attackAttachment.status, 404, 'Mercury student must NOT be able to download Venus attachment');

  // Authorized Venus student V CAN fetch the attachment
  const legitAttachment = await srv.request('GET', `/attachment/${venusAttachmentName}`, null, 'v1');
  assert.equal(legitAttachment.status, 200, 'Venus student must be able to download Venus attachment');
  assert.equal(legitAttachment.body, 'secret venus notes');

  // 18. Section 20: Push notification isolation
  // Check push_notification_outbox rows created when M sent a message:
  // Recipients must only include fellow Mercury student (m2), NEVER Venus, Earth, or Mars students
  const mercuryPushes = await f.db.all('SELECT recipient_student_id FROM push_notification_outbox WHERE chat_group_id=?', configs.M.chatGroupId);
  const mercuryRecipients = mercuryPushes.map(p => p.recipient_student_id);
  assert.ok(mercuryRecipients.includes('m2'), 'Mercury peer m2 should receive push notification');
  assert.ok(!mercuryRecipients.includes('m1'), 'Sender m1 should not receive push');
  assert.ok(!mercuryRecipients.includes('v1') && !mercuryRecipients.includes('v2'), 'Venus members must NOT receive Mercury push');
  assert.ok(!mercuryRecipients.includes('e1'), 'Earth members must NOT receive Mercury push');
  assert.ok(!mercuryRecipients.includes('s1') && !mercuryRecipients.includes('s2'), 'Mars members must NOT receive Mercury push');

  // 19. Section 11: CR permission scoping
  // m1 is CR of Mercury. Verify m1 CANNOT access or pin Venus/Earth/Mars.
  const crAttackPin = await srv.request('POST', `/pinned/${venusMsgId}`, null, 'm1');
  assert.equal(crAttackPin.status, 404, 'CR must NOT have room access beyond their own cohort');
});
