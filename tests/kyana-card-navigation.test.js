'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

describe('KYANA 3.0 Step 1 — Card Navigation & Deep Link Resolution', () => {
  let server;
  let port;
  let baseUrl;

  before(async () => {
    const app = express();
    const publicDir = path.join(__dirname, '..', 'public');

    // Serve static files from public (same as server.js)
    app.use(express.static(publicDir));

    // Register web navigation handlers exactly matching server.js
    app.get(['/assignments', '/code-lab', '/code-lab/'], (req, res) => {
      res.sendFile(path.join(publicDir, 'code-lab', 'subjects.html'));
    });

    app.get(['/assignments/:id', '/assignment/:id'], (req, res) => {
      const assignmentId = req.params.id;
      if (assignmentId && /^\d+$/.test(assignmentId)) {
        return res.redirect(`/code-lab/assignment.html?id=${encodeURIComponent(assignmentId)}`);
      }
      res.redirect('/code-lab/subjects.html');
    });

    app.get(['/posts/:id', '/post/:id'], (req, res) => {
      const postId = req.params.id;
      if (postId && /^\d+$/.test(postId)) {
        return res.redirect(`/dashboard.html?post=${encodeURIComponent(postId)}`);
      }
      res.redirect('/dashboard.html');
    });

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. Web Navigation Route Resolution', () => {
    test('Assignment direct deepLink (/code-lab/assignment.html?id=42) serves HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/code-lab/assignment.html?id=42`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Assignment Workspace — Code Lab'));
      assert.ok(text.includes("params.get('id')"));
    });

    test('Assignment route (/assignments/42) redirects 302 to /code-lab/assignment.html?id=42', async () => {
      const res = await fetch(`${baseUrl}/assignments/42`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/code-lab/assignment.html?id=42');
    });

    test('Assignment singular route (/assignment/42) redirects 302 to /code-lab/assignment.html?id=42', async () => {
      const res = await fetch(`${baseUrl}/assignment/42`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/code-lab/assignment.html?id=42');
    });

    test('Post route (/posts/101) redirects 302 to /dashboard.html?post=101', async () => {
      const res = await fetch(`${baseUrl}/posts/101`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/dashboard.html?post=101');
    });

    test('Post singular route (/post/101) redirects 302 to /dashboard.html?post=101', async () => {
      const res = await fetch(`${baseUrl}/post/101`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/dashboard.html?post=101');
    });

    test('Notice direct route (/notices.html?id=202) serves HTTP 200 and has scroll logic', async () => {
      const res = await fetch(`${baseUrl}/notices.html?id=202`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('University Notices'));
      assert.ok(text.includes("urlParams.get('id')"));
      assert.ok(text.includes('data-notice-id'));
    });

    test('Dashboard (/dashboard.html?post=101) serves HTTP 200 and has post deep link handler', async () => {
      const res = await fetch(`${baseUrl}/dashboard.html?post=101`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("urlParams.get('post')"));
      assert.ok(text.includes('data-post-id'));
    });
  });

  describe('2. Mobile Route File Existence & Screen Exports', () => {
    test('Mobile assignment screen (mobile/app/assignments/[id].tsx) exists and uses react-native-webview', () => {
      const filePath = path.join(__dirname, '../mobile/app/assignments/[id].tsx');
      assert.ok(fs.existsSync(filePath), 'mobile/app/assignments/[id].tsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('react-native-webview'), 'Screen must import react-native-webview');
      assert.ok(content.includes('export default function AssignmentWebViewScreen'), 'Must export screen component');
      assert.ok(content.includes('Linking.openURL'), 'Must provide system browser fallback');
    });

    test('Mobile assignment alias screen (mobile/app/assignment/[id].tsx) exists and re-exports assignments/[id]', () => {
      const filePath = path.join(__dirname, '../mobile/app/assignment/[id].tsx');
      assert.ok(fs.existsSync(filePath), 'mobile/app/assignment/[id].tsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes("export { default } from '../assignments/[id]'"));
    });

    test('Mobile post screen (mobile/app/post/[id].tsx) exists', () => {
      const filePath = path.join(__dirname, '../mobile/app/post/[id].tsx');
      assert.ok(fs.existsSync(filePath), 'mobile/app/post/[id].tsx must exist');
    });

    test('Mobile notice screen (mobile/app/notice/[id].tsx) exists', () => {
      const filePath = path.join(__dirname, '../mobile/app/notice/[id].tsx');
      assert.ok(fs.existsSync(filePath), 'mobile/app/notice/[id].tsx must exist');
    });

    test('mobile/app/kyana.tsx card press handler routes to /assignments/:id for assignments and post_assignments', () => {
      const kyanaFile = path.join(__dirname, '../mobile/app/kyana.tsx');
      const content = fs.readFileSync(kyanaFile, 'utf8');
      assert.ok(content.includes("card.type === 'assignment' || (card.type as string) === 'post_assignment'"));
      assert.ok(content.includes("router.push(`/assignments/${card.id}` as any)"));
    });
  });

  describe('3. Card Generation Helper Route Contracts', () => {
    const aiSearch = require('../lib/ai-search-tools');

    test('searchAssignments formats deepLink to /code-lab/assignment.html?id=:id and mobileRoute to /assignments/:id', async () => {
      const mockDb = {
        all: async () => [
          {
            id: 88,
            title: 'Mock Assignment',
            description: 'Test description',
            language: 'c',
            subject: 'Computer Programming I',
            semester: '1',
            deadline: '2026-11-01',
            teacher_name: 'Professor Test',
            createdAt: '2026-10-14'
          }
        ]
      };

      const academicContext = { authenticated: true, role: 'admin' };
      const results = await aiSearch.searchAssignments(mockDb, academicContext, { query: 'Mock' });
      assert.equal(results.length, 1);
      const card = results[0].resourceCard;
      assert.ok(card);
      assert.equal(card.type, 'assignment');
      assert.equal(card.id, 88);
      assert.equal(card.deepLink, '/code-lab/assignment.html?id=88');
      assert.equal(card.mobileRoute, '/assignments/88');
      assert.equal(card.action, 'view_assignment');
    });

    test('searchPosts formats deepLink and mobileRoute for posts', async () => {
      const mockDb = {
        all: async () => [
          {
            id: 99,
            title: 'Mock Post',
            content: 'Test content',
            type: 'status',
            category: 'general',
            created_at: '2026-10-14',
            author_name: 'Student Test',
            author_avatar: null
          }
        ]
      };

      const academicContext = { authenticated: true, role: 'admin' };
      const results = await aiSearch.searchPosts(mockDb, academicContext, { query: 'Mock' });
      assert.equal(results.length, 1);
      const card = results[0].resourceCard;
      assert.ok(card);
      assert.equal(card.type, 'post');
      assert.equal(card.id, 99);
      assert.equal(card.deepLink, '/posts/99');
      assert.equal(card.mobileRoute, '/post/99');
      assert.equal(card.action, 'view_post');
    });

    test('searchNotices formats deepLink and mobileRoute for notices', async () => {
      const mockDb = {
        all: async () => [
          {
            id: 105,
            title: 'Exam Notice',
            content: 'Notice content',
            type: 'notice',
            category: 'announcement',
            created_at: '2026-10-14',
            author_name: 'Admin Test',
            author_avatar: null
          }
        ]
      };

      const academicContext = { authenticated: true, role: 'admin' };
      const results = await aiSearch.searchNotices(mockDb, academicContext, { query: 'Exam' });
      assert.equal(results.length, 1);
      const card = results[0].resourceCard;
      assert.ok(card);
      assert.equal(card.type, 'notice');
      assert.equal(card.id, 105);
      assert.equal(card.deepLink, '/posts/105');
      assert.equal(card.mobileRoute, '/notice/105');
      assert.equal(card.action, 'view_notice');
    });
  });
});
