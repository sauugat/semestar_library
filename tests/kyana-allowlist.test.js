'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { isKnowledgeV3Enabled } = require('../lib/knowledge-schema');

describe('H8. KYANA AI 3.0 — Allowlist Rules Verification', () => {
  const originalFlag = process.env.KYANA_KNOWLEDGE_V3;
  const originalUsers = process.env.KYANA_KNOWLEDGE_V3_USERS;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.KYANA_KNOWLEDGE_V3;
    else process.env.KYANA_KNOWLEDGE_V3 = originalFlag;

    if (originalUsers === undefined) delete process.env.KYANA_KNOWLEDGE_V3_USERS;
    else process.env.KYANA_KNOWLEDGE_V3_USERS = originalUsers;
  });

  test('Rule 1: Flag false (or undefined) is OFF for everyone', () => {
    delete process.env.KYANA_KNOWLEDGE_V3;
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';
    assert.equal(isKnowledgeV3Enabled(), false);
    assert.equal(isKnowledgeV3Enabled('stu_alice'), false);

    process.env.KYANA_KNOWLEDGE_V3 = 'false';
    assert.equal(isKnowledgeV3Enabled(), false);
    assert.equal(isKnowledgeV3Enabled('stu_alice'), false);
    assert.equal(isKnowledgeV3Enabled('any_user'), false);
  });

  test('Rule 2: Flag true and list empty/undefined is OFF for everyone (safe default)', () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    delete process.env.KYANA_KNOWLEDGE_V3_USERS;
    assert.equal(isKnowledgeV3Enabled(), false, 'Empty list must be OFF by default');
    assert.equal(isKnowledgeV3Enabled('stu_alice'), false, 'Empty list must block student');

    process.env.KYANA_KNOWLEDGE_V3_USERS = '   ';
    assert.equal(isKnowledgeV3Enabled(), false, 'Whitespace list must be OFF');
    assert.equal(isKnowledgeV3Enabled('stu_alice'), false);
  });

  test('Rule 3: Flag true and non-empty list is ON ONLY for allowed IDs', () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = 'stu_alice, stu_bob, tea_carol';

    // Allowed users
    assert.equal(isKnowledgeV3Enabled('stu_alice'), true, 'stu_alice must be allowed');
    assert.equal(isKnowledgeV3Enabled('stu_bob'), true, 'stu_bob must be allowed');
    assert.equal(isKnowledgeV3Enabled('tea_carol'), true, 'tea_carol must be allowed');

    // Blocked users
    assert.equal(isKnowledgeV3Enabled('stu_dave'), false, 'Unlisted user stu_dave must be blocked');
    assert.equal(isKnowledgeV3Enabled('stu_eve'), false, 'Unlisted user stu_eve must be blocked');
    assert.equal(isKnowledgeV3Enabled(), false, 'Anonymous call without user ID must be blocked');
    assert.equal(isKnowledgeV3Enabled(null), false, 'Null user ID must be blocked');
  });

  test('Rule 4: Flag true and list="*" is ON for everyone', () => {
    process.env.KYANA_KNOWLEDGE_V3 = 'true';
    process.env.KYANA_KNOWLEDGE_V3_USERS = '*';

    assert.equal(isKnowledgeV3Enabled(), true, 'Wildcard is ON for anonymous');
    assert.equal(isKnowledgeV3Enabled('stu_alice'), true, 'Wildcard is ON for alice');
    assert.equal(isKnowledgeV3Enabled('random_student_999'), true, 'Wildcard is ON for any user');
  });
});
