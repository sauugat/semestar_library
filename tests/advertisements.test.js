'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensurePostsSchema } = require('../lib/posts');
const {
  ensureAdvertisementsSchema,
  interleaveAdvertisements
} = require('../lib/advertisements');
const createPostsRouter = require('../routes/posts');
const createAdvertisementsRouter = require('../routes/advertisements');

const testPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=',
  'base64'
);

const testMp4 = Buffer.from(
  '00000018667479706d703432000000006d70343269736f6d000000086d646174',
  'hex'
);

/**
 * Builds a RFC 7578 multipart/form-data payload buffer from field/file definitions
 * so multer parses multipart uploads without needing a TCP socket.
 */
function buildMultipartPayload(fields = {}, files = []) {
  const boundary = '----SemesterLibraryAdTestBoundary' + Math.random().toString(16).slice(2);
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${String(value)}\r\n`
      )
    );
  }

  for (const file of files) {
    const fieldName = file.field || 'file';
    const filename = file.filename || 'upload.png';
    const contentType = file.contentType || 'image/png';
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data || ''));
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
      )
    );
    chunks.push(dataBuf);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    buffer: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

/**
 * Dispatches an HTTP request directly through an Express application instance in-memory,
 * avoiding any dependency on loopback TCP socket permissions in sandboxed environments.
 */
function invokeExpressApp(app, method, urlPath, body, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    let payloadBuffer = Buffer.alloc(0);
    const headers = { ...customHeaders };

    if (body && body.__multipart) {
      const mp = buildMultipartPayload(body.fields, body.files);
      payloadBuffer = mp.buffer;
      headers['content-type'] = mp.contentType;
      headers['content-length'] = String(payloadBuffer.length);
    } else if (body !== undefined && body !== null) {
      payloadBuffer = Buffer.from(JSON.stringify(body), 'utf8');
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['content-length'] = String(payloadBuffer.length);
    }

    const req = new Readable({
      read() {
        if (payloadBuffer.length > 0) {
          this.push(payloadBuffer);
        }
        this.push(null);
      }
    });

    req.method = method.toUpperCase();
    req.url = urlPath;
    req.originalUrl = urlPath;
    req.baseUrl = '';
    req.path = urlPath.split('?')[0];
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.get = (name) => req.headers[String(name).toLowerCase()];
    req.header = req.get;
    const mockSocket = {
      remoteAddress: '127.0.0.1',
      destroy: () => {},
      on: () => {},
      once: () => {},
      emit: () => {},
      removeListener: () => {}
    };
    req.connection = mockSocket;
    req.socket = mockSocket;
    req.ip = '127.0.0.1';
    req._destroy = (err, cb) => cb(err);

    const { EventEmitter } = require('node:events');
    const res = new EventEmitter();
    const resChunks = [];
    const resHeaders = {};
    res.statusCode = 200;
    res.headersSent = false;
    res.locals = {};

    res.setHeader = (name, val) => {
      resHeaders[String(name).toLowerCase()] = val;
      return res;
    };
    res.getHeader = (name) => resHeaders[String(name).toLowerCase()];
    res.getHeaders = () => ({ ...resHeaders });
    res.hasHeader = (name) => Object.prototype.hasOwnProperty.call(resHeaders, String(name).toLowerCase());
    res.removeHeader = (name) => {
      delete resHeaders[String(name).toLowerCase()];
    };
    res.set = (field, val) => {
      if (typeof field === 'object' && field !== null) {
        for (const [k, v] of Object.entries(field)) res.setHeader(k, v);
      } else {
        res.setHeader(field, val);
      }
      return res;
    };
    res.header = res.set;
    res.get = res.getHeader;
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.type = (t) => {
      res.setHeader('content-type', t);
      return res;
    };
    res.writeHead = (statusCode, statusMessage, hdrs) => {
      res.statusCode = statusCode;
      const h = typeof statusMessage === 'object' ? statusMessage : hdrs;
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          resHeaders[String(k).toLowerCase()] = v;
        }
      }
      res.headersSent = true;
      return res;
    };
    res.write = (chunk) => {
      if (chunk) {
        resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return true;
    };
    res.end = (chunk) => {
      if (chunk !== undefined && chunk !== null) {
        resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      res.headersSent = true;
      const rawBuffer = Buffer.concat(resChunks);
      const rawText = rawBuffer.toString('utf8');
      let json = {};
      try {
        json = rawText ? JSON.parse(rawText) : {};
      } catch (_) {
        json = { raw: rawText };
      }
      res.emit('finish');
      resolve({
        status: res.statusCode || 200,
        headers: resHeaders,
        body: json,
        rawBuffer
      });
      return res;
    };
    res.send = (payload) => {
      if (Buffer.isBuffer(payload)) {
        if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/octet-stream');
        return res.end(payload);
      }
      if (typeof payload === 'object' && payload !== null) {
        return res.json(payload);
      }
      if (typeof payload === 'string' && !res.getHeader('content-type')) {
        res.setHeader('content-type', 'text/html; charset=utf-8');
      }
      return res.end(payload !== undefined && payload !== null ? String(payload) : '');
    };
    res.json = (obj) => {
      if (!res.getHeader('content-type')) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      return res.end(JSON.stringify(obj));
    };

    try {
      app.handle(req, res, (err) => {
        if (err) {
          const status = err.status || err.statusCode || 500;
          resolve({
            status,
            headers: resHeaders,
            body: { message: err.message || 'Internal Server Error' },
            rawBuffer: Buffer.alloc(0)
          });
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: 'Not Found' }));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function createAdTestFixture(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ad-uploads-'));
  const uploadDir = path.join(tempDir, 'posts');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const blobs = new Map();

  const normalizeArgs = (args) => {
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args.map((v) => (v === undefined ? null : v));
  };

  const db = {
    saveFileBlob: async (filename, fileData, mimeType) => {
      blobs.set(filename, { fileData, mimeType });
      return true;
    },
    getFileBlob: async (filename) => blobs.get(filename),
    deleteFileBlob: async (filename) => {
      blobs.delete(filename);
      return true;
    },
    isPostgres: false,
    exec: async (sql) => {
      sqlite.exec(sql);
    },
    all: async (sql, ...args) => {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...normalizeArgs(args)).map((r) => ({ ...r }));
    },
    get: async (sql, ...args) => {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...normalizeArgs(args));
      return row ? { ...row } : null;
    },
    run: async (sql, ...args) => {
      const stmt = sqlite.prepare(sql);
      const result = stmt.run(...normalizeArgs(args));
      return {
        lastInsertRowid: Number(result.lastInsertRowid),
        changes: Number(result.changes)
      };
    },
    initSchema: async () => {}
  };

  await db.exec(`
    CREATE TABLE students (
      studentId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'student',
      department TEXT DEFAULT 'BIT',
      semester TEXT DEFAULT 'Semester 1',
      cohort_id TEXT,
      avatarUrl TEXT,
      account_status TEXT DEFAULT 'active'
    );
    INSERT INTO students (studentId, name, role, semester, account_status) VALUES
      ('admin1', 'Saugat Admin', 'admin', 'Semester 1', 'active'),
      ('student1', 'Aashrita Student', 'student', 'Semester 1', 'active'),
      ('student2', 'Sem2 Student', 'student', 'Semester 2', 'active'),
      ('cr1', 'Sujan CR', 'cr', 'Semester 1', 'active'),
      ('teacher1', 'Faculty Teacher', 'teacher', 'Semester 1', 'active');
  `);

  await ensurePostsSchema(db);
  await ensureAdvertisementsSchema(db);

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => {
    const userId = req.headers['x-test-user'];
    req.session = userId ? { studentId: userId } : {};
    next();
  });

  const requireLogin = async (req, res, next) => {
    const studentId = req.session?.studentId;
    if (!studentId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    const user = await db.get('SELECT * FROM students WHERE studentId = ?', studentId);
    if (!user) {
      return res.status(401).json({ message: 'Account not found.' });
    }
    req.user = user;
    req.student = user;
    next();
  };

  app.use('/api/posts', createPostsRouter(db, requireLogin, { uploadDir }));
  app.use('/api/advertisements', createAdvertisementsRouter(db, requireLogin, { uploadDir }));
  app.use('/api/admin/advertisements', createAdvertisementsRouter(db, requireLogin, { uploadDir }));
  app.use('/uploads/posts', require('../routes/post-images')(db));

  t.after(async () => {
    sqlite.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function apiRequest(method, urlPath, body, user = 'admin1') {
    const headers = {};
    if (user) headers['x-test-user'] = user;
    return invokeExpressApp(app, method, urlPath, body, headers);
  }

  return { db, blobs, apiRequest, uploadDir };
}

// 1, 2, 3: Role-based authorization tests (Admins vs Students vs Teachers/CRs)
test('1-3. Only admins can create, update, activate/deactivate, or delete advertisements; students, CRs, and teachers are blocked', async (t) => {
  const { apiRequest } = await createAdTestFixture(t);

  const sampleAdPayload = {
    advertiser_name: 'GitHub Education',
    advertiser_logo_url: '/uploads/posts/logo.png',
    primary_text: 'Get the GitHub Student Developer Pack free for BIT students.',
    headline: 'Free Developer Tools for Students',
    description: 'Verified campus offer',
    media_url: '/uploads/posts/banner.png',
    media_type: 'image',
    cta_label: 'Claim Offer',
    destination_url: 'https://education.github.com/pack',
    status: 'active',
    is_active: true
  };

  // Requirement 2: Students cannot create advertisements
  const studentCreate = await apiRequest('POST', '/api/advertisements', sampleAdPayload, 'student1');
  assert.equal(studentCreate.status, 403);

  const crCreate = await apiRequest('POST', '/api/advertisements', sampleAdPayload, 'cr1');
  assert.equal(crCreate.status, 403);

  // Requirement 3: Teachers cannot create advertisements
  const teacherCreate = await apiRequest('POST', '/api/advertisements', sampleAdPayload, 'teacher1');
  assert.equal(teacherCreate.status, 403);

  // Students and teachers cannot access management listing
  assert.equal((await apiRequest('GET', '/api/advertisements/manage', undefined, 'student1')).status, 403);
  assert.equal((await apiRequest('GET', '/api/advertisements/manage', undefined, 'teacher1')).status, 403);

  // Requirement 1: Only admins can create advertisements
  const adminCreate = await apiRequest('POST', '/api/advertisements', sampleAdPayload, 'admin1');
  assert.equal(adminCreate.status, 201);
  assert.equal(adminCreate.body.advertiser_name, 'GitHub Education');
  assert.equal(adminCreate.body.cta_label, 'Claim Offer');
  assert.equal(adminCreate.body.is_active, 1);
  const adId = adminCreate.body.id;
  assert.ok(adId > 0);

  // Non-admins cannot edit, pause, or delete the created advertisement
  assert.equal((await apiRequest('PUT', `/api/advertisements/${adId}`, { headline: 'Hacked' }, 'student1')).status, 403);
  assert.equal((await apiRequest('POST', `/api/advertisements/${adId}/deactivate`, {}, 'teacher1')).status, 403);
  assert.equal((await apiRequest('DELETE', `/api/advertisements/${adId}`, undefined, 'student1')).status, 403);

  // Check /api/posts/meta exposes canCreateAdvertisement accurately per role
  const adminMeta = await apiRequest('GET', '/api/posts/meta', undefined, 'admin1');
  assert.equal(adminMeta.body.canCreateAdvertisement, true);
  const studentMeta = await apiRequest('GET', '/api/posts/meta', undefined, 'student1');
  assert.equal(studentMeta.body.canCreateAdvertisement, false);
  const teacherMeta = await apiRequest('GET', '/api/posts/meta', undefined, 'teacher1');
  assert.equal(teacherMeta.body.canCreateAdvertisement, false);
});

// 4, 5, 13: Active vs Inactive / Scheduled / Expired / Deactivated advertisements
test('4, 5, 13. Inactive/expired/future ads never appear; active ads appear and deactivated ads immediately disappear from feed responses', async (t) => {
  const { apiRequest } = await createAdTestFixture(t);

  // Seed 4 organic posts
  for (let i = 1; i <= 4; i++) {
    const p = await apiRequest('POST', '/api/posts', { content: `Organic post #${i}` }, 'student1');
    assert.equal(p.status, 201);
  }

  // Create 1 active ad, 1 inactive ad, 1 expired ad, 1 future scheduled ad
  const activeAd = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Active Sponsor',
    primary_text: 'Active promotion in feed',
    media_url: '/uploads/posts/active.png',
    media_type: 'image',
    cta_label: 'Learn More',
    destination_url: 'https://example.com/active',
    status: 'active',
    is_active: true
  }, 'admin1');
  assert.equal(activeAd.status, 201);

  const inactiveAd = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Inactive Sponsor',
    primary_text: 'Should not appear',
    media_url: '/uploads/posts/inactive.png',
    media_type: 'image',
    cta_label: 'Learn More',
    destination_url: 'https://example.com/inactive',
    status: 'inactive',
    is_active: false
  }, 'admin1');
  assert.equal(inactiveAd.status, 201);

  const expiredAd = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Expired Sponsor',
    primary_text: 'Expired campaign',
    media_url: '/uploads/posts/expired.png',
    media_type: 'image',
    cta_label: 'Learn More',
    destination_url: 'https://example.com/expired',
    status: 'active',
    is_active: true,
    start_date: '2020-01-01T00:00:00.000Z',
    end_date: '2020-01-02T00:00:00.000Z'
  }, 'admin1');
  assert.equal(expiredAd.status, 201);

  const futureAd = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Future Sponsor',
    primary_text: 'Starts in 2099',
    media_url: '/uploads/posts/future.png',
    media_type: 'image',
    cta_label: 'Learn More',
    destination_url: 'https://example.com/future',
    status: 'active',
    is_active: true,
    start_date: '2099-01-01T00:00:00.000Z'
  }, 'admin1');
  assert.equal(futureAd.status, 201);

  // Requirement 4 & 5: Only Active Sponsor appears in feed
  const feedRes = await apiRequest('GET', '/api/posts?limit=20&seed=session-alpha', undefined, 'student1');
  assert.equal(feedRes.status, 200);
  assert.equal(feedRes.body.eligibleAdvertisements.length, 1);
  assert.equal(feedRes.body.eligibleAdvertisements[0].advertiser_name, 'Active Sponsor');

  const sponsoredInFeed = feedRes.body.feedItems.filter(item => item.feedItemType === 'advertisement');
  assert.equal(sponsoredInFeed.length, 1);
  assert.equal(sponsoredInFeed[0].advertiser_name, 'Active Sponsor');

  // Requirement 13: Deactivating the active ad immediately removes it from subsequent feed responses
  const deact = await apiRequest('POST', `/api/advertisements/${activeAd.body.id}/deactivate`, {}, 'admin1');
  assert.equal(deact.status, 200);
  assert.equal(deact.body.is_active, 0);

  const feedAfterDeact = await apiRequest('GET', '/api/posts?limit=20&seed=session-alpha', undefined, 'student1');
  assert.equal(feedAfterDeact.body.eligibleAdvertisements.length, 0);
  assert.equal(feedAfterDeact.body.advertisements.length, 0);
  assert.equal(feedAfterDeact.body.feedItems.filter(i => i.feedItemType === 'advertisement').length, 0);
  // Organic posts remain intact without gaps
  assert.equal(feedAfterDeact.body.feedItems.length, 4);
});

// 6, 7, 8, 9: Placement rules (after every 2-3 organic posts, never at top, never consecutive, no duplicates, pagination safety)
test('6, 7, 8, 9. Ads are placed after every 2-3 organic posts, never at top, never consecutive, never duplicated in a session or across pagination', async (t) => {
  const { apiRequest } = await createAdTestFixture(t);

  // Create 10 organic posts
  for (let i = 1; i <= 10; i++) {
    await apiRequest('POST', '/api/posts', { content: `Organic post ${i}` }, 'student1');
  }

  // Create 3 active advertisements
  const createdAdIds = [];
  for (let a = 1; a <= 3; a++) {
    const res = await apiRequest('POST', '/api/advertisements', {
      advertiser_name: `Brand ${a}`,
      primary_text: `Sponsored text ${a}`,
      media_url: `/uploads/posts/ad_${a}.png`,
      media_type: 'image',
      cta_label: 'Visit',
      destination_url: `https://example.com/brand-${a}`,
      status: 'active',
      is_active: true
    }, 'admin1');
    assert.equal(res.status, 201);
    createdAdIds.push(res.body.id);
  }

  const feed = await apiRequest('GET', '/api/posts?limit=20&seed=placement-seed-1', undefined, 'student1');
  const items = feed.body.feedItems;

  // Organic posts are never replaced (10 organic + 3 ads = 13 items)
  const organicItems = items.filter(i => i.feedItemType !== 'advertisement');
  const adItems = items.filter(i => i.feedItemType === 'advertisement');
  assert.equal(organicItems.length, 10);
  assert.equal(adItems.length, 3);

  // Never at the very top of the feed (index 0 and index 1 must be organic)
  assert.notEqual(items[0].feedItemType, 'advertisement');
  assert.notEqual(items[1].feedItemType, 'advertisement');

  // Verify spacing: each ad appears after 2 or 3 organic posts, and ads are never consecutive
  let organicSinceLastAd = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].feedItemType === 'advertisement') {
      assert.ok(organicSinceLastAd === 2 || organicSinceLastAd === 3, `Expected 2 or 3 organic posts before ad at index ${i}, got ${organicSinceLastAd}`);
      if (i > 0) {
        assert.notEqual(items[i - 1].feedItemType, 'advertisement', 'Advertisements must never be consecutive');
      }
      organicSinceLastAd = 0;
    } else {
      organicSinceLastAd++;
    }
  }

  // Requirement 8: No duplicate advertisements in the feed
  const adIdsInFeed = adItems.map(a => a.id);
  assert.equal(new Set(adIdsInFeed).size, adIdsInFeed.length);

  // Stable placement across rerenders with the same seed
  const feedRerender = await apiRequest('GET', '/api/posts?limit=20&seed=placement-seed-1', undefined, 'student1');
  assert.deepEqual(
    feedRerender.body.feedItems.map(i => `${i.feedItemType}:${i.id}`),
    items.map(i => `${i.feedItemType}:${i.id}`)
  );

  // Idempotency check: passing already-interleaved feedItems into interleaveAdvertisements never double-inserts ads
  const doubleCheck = interleaveAdvertisements(items, feed.body.eligibleAdvertisements, { seed: 'placement-seed-1' });
  assert.deepEqual(
    doubleCheck.feedItems.map(i => `${i.feedItemType}:${i.id}`),
    items.map(i => `${i.feedItemType}:${i.id}`)
  );

  // Requirement 9: Pagination does not duplicate advertisements
  const page1 = await apiRequest('GET', '/api/posts?limit=5&seed=paginated-seed', undefined, 'student1');
  assert.equal(page1.body.posts.length, 5);
  assert.ok(page1.body.nextCursor);
  const page1AdIds = page1.body.placedAdIds;
  assert.ok(page1AdIds.length >= 1);

  // Fetch page 2 using before cursor (both automatic session tracking and excludeAdIds prevent duplicates)
  const page2 = await apiRequest('GET', `/api/posts?limit=5&before=${page1.body.nextCursor}&seed=paginated-seed`, undefined, 'student1');
  assert.equal(page2.body.posts.length, 5);
  const page2AdIds = page2.body.placedAdIds;

  // Verify zero overlap between page 1 ads and page 2 ads
  for (const id of page2AdIds) {
    assert.ok(!page1AdIds.includes(id), `Ad ${id} from page 1 was duplicated on page 2`);
  }
});

// 10: Organic post visibility and semester filtering rules remain unchanged
test('10. Organic post visibility and semester targeting rules remain strictly enforced alongside advertisements', async (t) => {
  const { apiRequest } = await createAdTestFixture(t);

  // Student 1 (Semester 1) posts a students_only post targeting Semester 1
  const s1Post = await apiRequest('POST', '/api/posts', {
    content: 'Semester 1 student-only discussion',
    visibility: 'students_only',
    targetSemesters: [1]
  }, 'student1');
  assert.equal(s1Post.status, 201);

  // Student 2 (Semester 2) posts a post targeting Semester 2 only
  const s2Post = await apiRequest('POST', '/api/posts', {
    content: 'Semester 2 exclusive study group',
    visibility: 'everyone',
    targetSemesters: [2]
  }, 'student2');
  assert.equal(s2Post.status, 201);

  // Admin creates an active advertisement
  await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Campus Bookstore',
    primary_text: '20% off Semester textbooks',
    media_url: '/uploads/posts/books.png',
    media_type: 'image',
    cta_label: 'Shop Now',
    destination_url: 'https://example.com/books',
    status: 'active',
    is_active: true
  }, 'admin1');

  // Student 1 (Semester 1) sees s1Post, does NOT see s2Post
  const s1Feed = await apiRequest('GET', '/api/posts?limit=20&seed=vis-seed', undefined, 'student1');
  const s1PostIds = s1Feed.body.posts.map(p => p.id);
  assert.ok(s1PostIds.includes(s1Post.body.id));
  assert.ok(!s1PostIds.includes(s2Post.body.id));

  // Teacher 1 does NOT see students_only post (s1Post)
  const teacherFeed = await apiRequest('GET', '/api/posts?limit=20&seed=vis-seed', undefined, 'teacher1');
  const teacherPostIds = teacherFeed.body.posts.map(p => p.id);
  assert.ok(!teacherPostIds.includes(s1Post.body.id));
});

// 11, 12: First-party analytics — Impression deduplication and CTA click recording
test('11, 12. Impression tracking is deduplicated per user/session window and CTA clicks increment accurately without exposing private student data', async (t) => {
  const { apiRequest, db } = await createAdTestFixture(t);

  const created = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'JetBrains Campus',
    primary_text: 'Free IntelliJ IDEA Ultimate for students',
    media_url: '/uploads/posts/jetbrains.png',
    media_type: 'image',
    cta_label: 'Download',
    destination_url: 'https://www.jetbrains.com/community/education/',
    status: 'active',
    is_active: true
  }, 'admin1');
  const adId = created.body.id;

  // First impression from student1 in session A -> recorded
  const imp1 = await apiRequest('POST', `/api/advertisements/${adId}/impression`, { sessionKey: 'sess-A' }, 'student1');
  assert.equal(imp1.status, 200);
  assert.equal(imp1.body.recorded, true);
  assert.equal(imp1.body.deduplicated, false);
  assert.equal(imp1.body.impression_count, 1);

  // Repeated render / impression from same student1 in same session A -> deduplicated!
  const imp2 = await apiRequest('POST', `/api/advertisements/${adId}/impression`, { sessionKey: 'sess-A' }, 'student1');
  assert.equal(imp2.status, 200);
  assert.equal(imp2.body.recorded, false);
  assert.equal(imp2.body.deduplicated, true);
  assert.equal(imp2.body.impression_count, 1);

  // Impression from student2 -> recorded (count = 2)
  const imp3 = await apiRequest('POST', `/api/advertisements/${adId}/impression`, { sessionKey: 'sess-B' }, 'student2');
  assert.equal(imp3.status, 200);
  assert.equal(imp3.body.recorded, true);
  assert.equal(imp3.body.impression_count, 2);

  // Verify raw studentId is hashed/anonymized in advertisement_impressions table
  const storedImp = await db.get('SELECT viewer_key FROM advertisement_impressions WHERE advertisement_id = ?', adId);
  assert.ok(storedImp);
  assert.notEqual(storedImp.viewer_key, 'student1');
  assert.equal(storedImp.viewer_key.length, 32);

  // Requirement 12: CTA clicks are recorded accurately
  const click1 = await apiRequest('POST', `/api/advertisements/${adId}/click`, { sessionKey: 'sess-A' }, 'student1');
  assert.equal(click1.status, 200);
  assert.equal(click1.body.recorded, true);
  assert.equal(click1.body.click_count, 1);
  assert.equal(click1.body.destination_url, 'https://www.jetbrains.com/community/education/');

  const click2 = await apiRequest('POST', `/api/advertisements/${adId}/click`, { sessionKey: 'sess-B' }, 'student2');
  assert.equal(click2.status, 200);
  assert.equal(click2.body.click_count, 2);

  // Admin management endpoint reflects accurate impression, click, and CTR stats
  const manageRes = await apiRequest('GET', '/api/advertisements/manage', undefined, 'admin1');
  assert.equal(manageRes.status, 200);
  const managedAd = manageRes.body.advertisements.find(a => a.id === adId);
  assert.equal(managedAd.impression_count, 2);
  assert.equal(managedAd.click_count, 2);
  assert.equal(managedAd.ctr, 100);
});

// 14: Multipart media upload reuse and both mobile and website integration verification
test('14. Multipart creative/logo upload persists to blob storage and mobile + website feed/composer integrations contain all required components', async (t) => {
  const { apiRequest } = await createAdTestFixture(t);

  // Test multipart/form-data advertisement creation with image creative and logo
  const createRes = await apiRequest('POST', '/api/advertisements', {
    __multipart: true,
    fields: {
      advertiser_name: 'Coursera Campus',
      primary_text: 'Unlimited guided projects for BIT students.',
      headline: 'Coursera for Campus',
      description: 'Included with your university email',
      cta_label: 'Enroll Free',
      destination_url: 'https://www.coursera.org/campus',
      status: 'active'
    },
    files: [
      { field: 'creative', filename: 'creative.png', contentType: 'image/png', data: testPng },
      { field: 'logo', filename: 'logo.png', contentType: 'image/png', data: testPng }
    ]
  }, 'admin1');

  assert.equal(createRes.status, 201);
  assert.match(createRes.body.media_url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);
  assert.match(createRes.body.advertiser_logo_url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);

  // Verify the uploaded creative and logo are served by /uploads/posts/:filename
  const mediaFetch = await apiRequest('GET', createRes.body.media_url, undefined, 'student1');
  assert.equal(mediaFetch.status, 200);
  assert.deepEqual(mediaFetch.rawBuffer, testPng);

  const logoFetch = await apiRequest('GET', createRes.body.advertiser_logo_url, undefined, 'student1');
  assert.equal(logoFetch.status, 200);
  assert.deepEqual(logoFetch.rawBuffer, testPng);

  // Verify website and mobile files contain the integrated SponsoredAdCard, placement, and admin interfaces
  const rootDir = path.join(__dirname, '..');
  const [
    webDashboardHtml,
    webCreatePostHtml,
    webAdminDashboardHtml,
    mobileHomeTsx,
    mobileSponsoredCardTsx,
    mobileAdServiceTs
  ] = await Promise.all([
    fs.readFile(path.join(rootDir, 'public', 'dashboard.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'public', 'create-post.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'public', 'admin-dashboard.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'mobile', 'app', '(tabs)', 'index.tsx'), 'utf8'),
    fs.readFile(path.join(rootDir, 'mobile', 'components', 'SponsoredAdCard.tsx'), 'utf8'),
    fs.readFile(path.join(rootDir, 'mobile', 'services', 'advertisements.ts'), 'utf8')
  ]);

  assert.ok(webDashboardHtml.includes('renderSponsoredAdCard'), 'Website dashboard renders SponsoredAdCard');
  assert.ok(webDashboardHtml.includes('interleaveAdvertisementsIntoFeed'), 'Website dashboard interleaves ads deterministically');
  assert.ok(webCreatePostHtml.includes('advertisementComposerForm'), 'Website create-post includes admin advertisement composer');
  assert.ok(webAdminDashboardHtml.includes('view-advertisements'), 'Website admin dashboard includes Advertisement Management view');
  assert.ok(mobileHomeTsx.includes('SponsoredAdCard'), 'Mobile homepage FlatList renders SponsoredAdCard');
  assert.ok(mobileHomeTsx.includes('interleaveFeedWithAds'), 'Mobile homepage interleaves ads deterministically');
  assert.ok(mobileSponsoredCardTsx.includes('Sponsored'), 'Mobile SponsoredAdCard displays Sponsored label and CTA');
  assert.ok(mobileAdServiceTs.includes('recordAdImpression'), 'Mobile ad service deduplicates impressions');
});

// 15: Regression test — Mobile two-step upload flow (/api/advertisements/media + /api/advertisements) for both image and video creatives, authorization, and immediate media retrieval
test('15. Mobile /api/advertisements/media upload endpoint works for both images and videos, enforces admin authorization, persists to file_blobs, and serves media before and after ad creation without breaking ordinary post uploads', async (t) => {
  const { apiRequest, blobs } = await createAdTestFixture(t);

  // 1. Non-admin users and unauthenticated requests are blocked from /api/advertisements/media
  const unauthMedia = await apiRequest('POST', '/api/advertisements/media', {
    __multipart: true,
    fields: {},
    files: [{ field: 'file', filename: 'ad.png', contentType: 'image/png', data: testPng }]
  }, null);
  assert.equal(unauthMedia.status, 401);

  for (const nonAdmin of ['student1', 'cr1', 'teacher1']) {
    const forbiddenMedia = await apiRequest('POST', '/api/advertisements/media', {
      __multipart: true,
      fields: {},
      files: [{ field: 'file', filename: 'ad.png', contentType: 'image/png', data: testPng }]
    }, nonAdmin);
    assert.equal(forbiddenMedia.status, 403, `Role ${nonAdmin} must receive 403 on /api/advertisements/media`);
  }

  // 2. Admin uploads an image creative via POST /api/advertisements/media
  const imgUpload = await apiRequest('POST', '/api/advertisements/media', {
    __multipart: true,
    fields: {},
    files: [{ field: 'file', filename: 'campus_banner.png', contentType: 'image/png', data: testPng }]
  }, 'admin1');
  assert.equal(imgUpload.status, 201);
  assert.equal(imgUpload.body.media_type, 'image');
  assert.equal(imgUpload.body.mime_type, 'image/png');
  assert.match(imgUpload.body.url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);
  assert.ok(blobs.has(imgUpload.body.filename), 'Image must be persisted in file_blobs');

  // Verify the uploaded image can be retrieved immediately (even before POST /api/advertisements is called)
  const preCreateImgFetch = await apiRequest('GET', imgUpload.body.url, undefined, 'admin1');
  assert.equal(preCreateImgFetch.status, 200);
  assert.equal(preCreateImgFetch.headers['content-type'], 'image/png');
  assert.deepEqual(preCreateImgFetch.rawBuffer, testPng);

  // 3. Admin uploads a video creative via POST /api/advertisements/media (including mobile raw 'video' or 'video/mp4' MIME)
  const vidUpload = await apiRequest('POST', '/api/advertisements/media', {
    __multipart: true,
    fields: {},
    files: [{ field: 'file', filename: 'promo_reel.mp4', contentType: 'video/mp4', data: testMp4 }]
  }, 'admin1');
  assert.equal(vidUpload.status, 201);
  assert.equal(vidUpload.body.media_type, 'video');
  assert.equal(vidUpload.body.mime_type, 'video/mp4');
  assert.match(vidUpload.body.url, /^\/uploads\/posts\/[a-f0-9-]+\.mp4$/);
  assert.ok(blobs.has(vidUpload.body.filename), 'Video must be persisted in file_blobs');

  // Verify the uploaded video can be retrieved immediately with video/mp4 Content-Type
  const preCreateVidFetch = await apiRequest('GET', vidUpload.body.url, undefined, 'student1');
  assert.equal(preCreateVidFetch.status, 200);
  assert.equal(preCreateVidFetch.headers['content-type'], 'video/mp4');
  assert.deepEqual(preCreateVidFetch.rawBuffer, testMp4);

  // 4. Test mobile picker edge case where contentType is raw 'video' or 'application/octet-stream' with .mov extension
  const movUpload = await apiRequest('POST', '/api/advertisements/media', {
    __multipart: true,
    fields: {},
    files: [{ field: 'file', filename: 'ios_clip.mov', contentType: 'video', data: testMp4 }]
  }, 'admin1');
  assert.equal(movUpload.status, 201);
  assert.equal(movUpload.body.media_type, 'video');
  assert.equal(movUpload.body.mime_type, 'video/quicktime');
  assert.match(movUpload.body.url, /^\/uploads\/posts\/[a-f0-9-]+\.mov$/);

  // 5. Complete mobile JSON creation flow for video advertisement
  const createdVidAd = await apiRequest('POST', '/api/advertisements', {
    advertiser_name: 'Figma for Education',
    advertiser_logo_url: imgUpload.body.url,
    primary_text: 'Collaborate on UI/UX projects with free Figma Professional for students.',
    headline: 'Free Figma Pro for BIT Students',
    description: 'Verify with your campus account',
    media_url: vidUpload.body.url,
    media_type: vidUpload.body.media_type,
    mime_type: vidUpload.body.mime_type,
    cta_label: 'Get Started',
    destination_url: 'https://www.figma.com/education/',
    status: 'active',
    is_active: true
  }, 'admin1');
  assert.equal(createdVidAd.status, 201);
  assert.equal(createdVidAd.body.media_type, 'video');
  assert.equal(createdVidAd.body.media_url, vidUpload.body.url);
  assert.equal(createdVidAd.body.advertiser_logo_url, imgUpload.body.url);

  // Verify video and logo are still retrievable and appear in eligible feed ads
  const postCreateVidFetch = await apiRequest('GET', createdVidAd.body.media_url, undefined, 'student1');
  assert.equal(postCreateVidFetch.status, 200);
  assert.deepEqual(postCreateVidFetch.rawBuffer, testMp4);

  const eligibleRes = await apiRequest('GET', '/api/advertisements/eligible', undefined, 'student1');
  assert.equal(eligibleRes.status, 200);
  const foundVidAd = eligibleRes.body.advertisements.find(a => a.id === createdVidAd.body.id);
  assert.ok(foundVidAd, 'Created video advertisement must be returned in eligible advertisements');
  assert.equal(foundVidAd.media_type, 'video');

  // 6. Verify ordinary post attachment upload and post creation still work without regression
  const normalAtt = await apiRequest('POST', '/api/posts/attachments', {
    __multipart: true,
    fields: {},
    files: [{ field: 'file', filename: 'notes_photo.png', contentType: 'image/png', data: testPng }]
  }, 'student1');
  assert.equal(normalAtt.status, 201);
  assert.match(normalAtt.body.url, /^\/uploads\/posts\/[a-f0-9-]+\.png$/);

  const normalPost = await apiRequest('POST', '/api/posts', {
    content: 'Normal student post with uploaded photo attachment',
    category: 'general',
    attachments: [normalAtt.body]
  }, 'student1');
  assert.equal(normalPost.status, 201);
  assert.equal(normalPost.body.attachment_url, normalAtt.body.url);

  const normalImgFetch = await apiRequest('GET', normalAtt.body.url, undefined, 'student2');
  assert.equal(normalImgFetch.status, 200);
  assert.deepEqual(normalImgFetch.rawBuffer, testPng);
});
