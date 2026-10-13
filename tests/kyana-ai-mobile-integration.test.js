'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');

const aiChatService = require('../lib/ai-chat-service');
const { createChatHandler } = require('../lib/chat-http');
const ts = require('../mobile/node_modules/typescript');

function loadTs(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../mobile/services', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(
    name => { if (!imports[name]) throw Error(`Unexpected import ${name}`); return imports[name]; },
    module,
    module.exports
  );
  return module.exports;
}

const {
  normalizeUnifiedConversations,
  sortUnifiedConversations,
  filterUnifiedConversations,
  searchUnifiedConversations,
} = loadTs('unified-inbox.ts');

// Create mock SQLite-like in-memory database adapter
function createMockDb() {
  const tables = {
    ai_conversations: [],
    ai_messages: []
  };

  return {
    isPostgres: false,
    async exec(sql) {
      // In-memory mock exec
      return true;
    },
    async run(sql, ...params) {
      const norm = sql.toLowerCase().replace(/\s+/g, ' ').trim();

      if (norm.startsWith('insert into ai_conversations')) {
        const id = params[0];
        const studentId = params[1];
        const title = params[2] || 'Chat with Kyana';
        const lastMessage = params[3] || null;
        const now = new Date().toISOString();
        tables.ai_conversations.push({
          id,
          student_id: studentId,
          title,
          last_message: lastMessage,
          last_message_at: now,
          created_at: now,
          updated_at: now
        });
        return { lastInsertRowid: tables.ai_conversations.length };
      }

      if (norm.startsWith('insert into ai_messages')) {
        const isUser = norm.includes("'user'");
        const convId = params[0];
        const studentId = params[1];
        const text = params[2];
        const metadata = isUser ? '{}' : (params[3] || '{}');
        const now = new Date().toISOString();
        const id = tables.ai_messages.length + 1;
        tables.ai_messages.push({
          id,
          conversation_id: convId,
          student_id: studentId,
          sender: isUser ? 'user' : 'assistant',
          text,
          metadata,
          created_at: now
        });
        return { lastInsertRowid: id, id };
      }

      if (norm.startsWith('update ai_conversations')) {
        if (norm.includes('set last_message = ?')) {
          const [lastMsg, convId, studentId] = params;
          const conv = tables.ai_conversations.find(c => c.id === convId && c.student_id === studentId);
          if (conv) {
            conv.last_message = lastMsg;
            conv.last_message_at = new Date().toISOString();
            conv.updated_at = new Date().toISOString();
          }
        } else if (norm.includes('set last_message = null')) {
          const [convId, studentId] = params;
          const conv = tables.ai_conversations.find(c => c.id === convId && c.student_id === studentId);
          if (conv) {
            conv.last_message = null;
            conv.updated_at = new Date().toISOString();
          }
        }
        return { changes: 1 };
      }

      if (norm.startsWith('delete from ai_messages')) {
        const [convId, studentId] = params;
        tables.ai_messages = tables.ai_messages.filter(
          m => !(m.conversation_id === convId && m.student_id === studentId)
        );
        return { changes: 1 };
      }

      if (norm.startsWith('delete from ai_conversations')) {
        const [convId, studentId] = params;
        tables.ai_conversations = tables.ai_conversations.filter(
          c => !(c.id === convId && c.student_id === studentId)
        );
        return { changes: 1 };
      }

      return { changes: 0 };
    },
    async get(sql, ...params) {
      const norm = sql.toLowerCase().replace(/\s+/g, ' ').trim();
      if (norm.includes('from ai_conversations where student_id = ?')) {
        const [studentId] = params;
        const matches = tables.ai_conversations.filter(c => c.student_id === studentId);
        matches.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return matches[0] || null;
      }
      if (norm.includes('from ai_conversations where id = ? and student_id = ?')) {
        const [convId, studentId] = params;
        return tables.ai_conversations.find(c => c.id === convId && c.student_id === studentId) || null;
      }
      return null;
    },
    async all(sql, ...params) {
      const norm = sql.toLowerCase().replace(/\s+/g, ' ').trim();
      if (norm.includes('from ai_conversations where student_id = ?')) {
        const [studentId] = params;
        const matches = tables.ai_conversations.filter(c => c.student_id === studentId);
        matches.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return matches;
      }
      if (norm.includes('from ai_messages where conversation_id = ? and student_id = ?')) {
        const [convId, studentId, limit] = params;
        const msgs = tables.ai_messages.filter(m => m.conversation_id === convId && m.student_id === studentId);
        return msgs.slice(0, limit || 50);
      }
      return [];
    }
  };
}

describe('Kyana AI Integration Suite', () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
  });

  test('1. aiChatService creates active conversation and saves messages', async () => {
    const studentId = 'student_test_1';
    const active = await aiChatService.getOrCreateActiveConversation(db, studentId);
    assert.ok(active, 'Active conversation should be created');
    assert.equal(active.studentId, studentId);

    // Save user message
    const userMsg = await aiChatService.saveUserMessage(db, studentId, active.id, 'Hello Kyana!');
    assert.ok(userMsg, 'User message should be saved');
    assert.equal(userMsg.sender, 'user');
    assert.equal(userMsg.text, 'Hello Kyana!');

    // Save assistant reply
    const asstMsg = await aiChatService.saveAssistantMessage(db, studentId, active.id, 'Hey there! How can I help?');
    assert.ok(asstMsg, 'Assistant message should be saved');
    assert.equal(asstMsg.sender, 'assistant');
    assert.equal(asstMsg.text, 'Hey there! How can I help?');

    // Retrieve messages
    const msgs = await aiChatService.getMessages(db, studentId, active.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].sender, 'user');
    assert.equal(msgs[1].sender, 'assistant');

    // Verify inbox preview
    const preview = await aiChatService.getInboxPreview(db, studentId);
    assert.equal(preview.title, '✦ Kyana AI');
    assert.equal(preview.subtitle, 'Hey there! How can I help?');
    assert.equal(preview.isPinned, true);
  });

  test('2. Conversation ownership security: student B cannot access student A conversation', async () => {
    const studentA = 'student_alice';
    const studentB = 'student_bob';

    const convA = await aiChatService.getOrCreateActiveConversation(db, studentA);
    await aiChatService.saveUserMessage(db, studentA, convA.id, 'Secret message of Alice');

    // Bob attempts to get messages from Alice's conversation
    const bobView = await aiChatService.getMessages(db, studentB, convA.id);
    assert.equal(bobView.length, 0, 'Bob must not receive Alice messages');

    // Bob attempts to clear Alice's conversation
    const clearResult = await aiChatService.clearConversation(db, studentB, convA.id);
    assert.equal(clearResult, false, 'Bob cannot clear Alice conversation');

    // Alice messages still intact
    const aliceMsgs = await aiChatService.getMessages(db, studentA, convA.id);
    assert.equal(aliceMsgs.length, 1);
  });

  test('3. Clear conversation wipes messages but preserves conversation identity', async () => {
    const studentId = 'student_clear_test';
    const conv = await aiChatService.getOrCreateActiveConversation(db, studentId);
    await aiChatService.saveUserMessage(db, studentId, conv.id, 'Test message 1');
    await aiChatService.saveAssistantMessage(db, studentId, conv.id, 'Test reply 1');

    assert.equal((await aiChatService.getMessages(db, studentId, conv.id)).length, 2);

    const cleared = await aiChatService.clearConversation(db, studentId, conv.id);
    assert.equal(cleared, true);

    const msgsAfter = await aiChatService.getMessages(db, studentId, conv.id);
    assert.equal(msgsAfter.length, 0);

    const previewAfter = await aiChatService.getInboxPreview(db, studentId);
    assert.equal(previewAfter.subtitle, 'How can I help you today?');
  });

  test('4. POST /api/ai/chat handler automatically persists messages for authenticated students', async () => {
    const mockAssistant = {
      handleChat: async (db, message, info, history, sessionId, options) => {
        options?.onDelta?.('Thinking... ');
        return {
          reply: `Hello! You asked: ${message}`,
          actions: [],
          matchedFiles: []
        };
      }
    };

    const handler = createChatHandler(db, mockAssistant);

    const req = {
      user: { studentId: 'student_handler_test' },
      body: {
        message: 'What is a binary tree?'
      },
      headers: {
        accept: 'application/json'
      }
    };

    let statusCode = 200;
    let jsonResult = null;
    const res = {
      status(c) { statusCode = c; return this; },
      json(data) { jsonResult = data; return this; }
    };

    await handler(req, res);
    assert.equal(statusCode, 200);
    assert.ok(jsonResult.reply.includes('What is a binary tree?'));
    assert.ok(jsonResult.conversationId);

    // Verify messages persisted in DB
    const msgs = await aiChatService.getMessages(db, 'student_handler_test', jsonResult.conversationId);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].text, 'What is a binary tree?');
    assert.ok(msgs[1].text.includes('What is a binary tree?'));
  });

  test('5. Unified Inbox sorting strictly pins Kyana AI at the top', () => {
    const items = [
      {
        key: 'dm:123',
        type: 'dm',
        conversationId: '123',
        peerId: 'p1',
        title: 'Alice',
        subtitle: 'See you tomorrow',
        timestamp: new Date(Date.now() - 1000).toISOString(),
        unreadCount: 1,
      },
      {
        key: 'cohort:grp1',
        type: 'cohort',
        chatGroupId: 'grp1',
        cohortId: 'c1',
        groupCode: 'MERCURY',
        title: 'Mercury Cohort',
        subtitle: 'Lecture notes uploaded',
        timestamp: new Date(Date.now() - 500).toISOString(),
        unreadCount: 0,
        currentSemester: 2,
        roomStatus: 'active',
      },
      {
        key: 'kyana',
        type: 'kyana',
        title: '✦ Kyana AI',
        subtitle: 'How can I help you today?',
        timestamp: new Date(Date.now() - 10000).toISOString(),
        unreadCount: 0,
        isPinned: true,
      }
    ];

    const sorted = sortUnifiedConversations(items);
    assert.equal(sorted[0].type, 'kyana', 'Kyana AI must be the very first item');
    assert.equal(sorted[0].key, 'kyana');
    assert.equal(sorted[1].type, 'cohort');
    assert.equal(sorted[2].type, 'dm');
  });

  test('6. Unified Inbox filtering and search include Kyana AI appropriately', () => {
    const kyanaItem = {
      key: 'kyana',
      type: 'kyana',
      title: '✦ Kyana AI',
      subtitle: 'How can I help you today?',
      timestamp: new Date().toISOString(),
      unreadCount: 0,
      isPinned: true,
    };
    const cohortItem = {
      key: 'cohort:grp1',
      type: 'cohort',
      chatGroupId: 'grp1',
      cohortId: 'c1',
      groupCode: 'VENUS',
      title: 'Venus Cohort',
      subtitle: 'Exam updates',
      timestamp: new Date().toISOString(),
      unreadCount: 2,
      currentSemester: 1,
      roomStatus: 'active',
    };

    const list = [kyanaItem, cohortItem];

    // Filter 'all' includes both
    const all = filterUnifiedConversations(list, 'all');
    assert.equal(all.length, 2);

    // Filter 'groups' excludes Kyana (Kyana is personal AI, not cohort group)
    const groups = filterUnifiedConversations(list, 'groups');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].type, 'cohort');

    // Search query matches Kyana
    const searchMatch = searchUnifiedConversations(list, 'kyana');
    assert.equal(searchMatch.length, 1);
    assert.equal(searchMatch[0].type, 'kyana');

    const searchAi = searchUnifiedConversations(list, 'AI');
    assert.equal(searchAi.length, 1);
    assert.equal(searchAi[0].type, 'kyana');
  });

  test('7. Mobile components and navigation verify proper wiring', () => {
    const chatScreenFile = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app', '(tabs)', 'chat.tsx'), 'utf8');
    assert.match(chatScreenFile, /fetchKyanaPreview/);
    assert.match(chatScreenFile, /onSelectKyana/);
    assert.match(chatScreenFile, /router\.push\('\/kyana'/);

    const inboxFile = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'components', 'chat', 'UnifiedChatInbox.tsx'), 'utf8');
    assert.match(inboxFile, /item\.type === 'kyana'/);
    assert.match(inboxFile, /kyanaPinnedRow/);
    assert.match(inboxFile, /aiBadge/);

    const kyanaScreenFile = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app', 'kyana.tsx'), 'utf8');
    assert.match(kyanaScreenFile, /PostMarkdown/);
    assert.match(kyanaScreenFile, /sendKyanaMessage/);
    assert.match(kyanaScreenFile, /clearKyanaConversation/);
    assert.match(kyanaScreenFile, /handleRegenerate/);
    assert.match(kyanaScreenFile, /handleCopyMessage/);
  });
});
