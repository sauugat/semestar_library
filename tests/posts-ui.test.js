const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../public/dashboard.html'), 'utf8');
function functionSection(start, end) {
  return html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
}

function fixture(fetch) {
  const count = { textContent: '2' };
  const attributes = { 'aria-pressed': 'false' };
  const svg = { setAttribute: (name, value) => { attributes[name] = value; } };
  const classes = new Set();
  const button = {
    dataset: { liked: 'false' }, disabled: false,
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => { attributes[name] = value; },
    querySelector: selector => selector === 'svg' ? svg : count
  };
  const toasts = [];
  const context = vm.createContext({
    URL, window: { location: { origin: 'https://example.com' } },
    document: { querySelector: () => button }, fetch,
    showToast: text => toasts.push(text),
    button, feedItems: [{ id: 1, _feedType: 'post', liked_by_me: false, like_count: 2 }]
  });
  vm.runInContext([
    functionSection('    function escapeHtml(', '    function formatSize('),
    functionSection('    function timeAgo(', '    function getFileBadge('),
    functionSection('    function renderPost(', '    function renderFilePost('),
    functionSection('    function renderAssignmentPost(', '    async function deleteAssignmentPost('),
    functionSection('    function safePostUrl(', '    function renderFeed('),
    functionSection('    const pendingPostLikes =', '    async function deleteStatusPost(')
  ].join('\n'), context);
  return { context, button, count, attributes, classes, toasts };
}

test('like renders optimistically, blocks repeat clicks and reconciles the server count', async () => {
  let resolve;
  let calls = 0;
  let method;
  const f = fixture((url, options) => {
    calls++;
    method = options.method;
    return new Promise(done => { resolve = done; });
  });
  const pending = vm.runInContext('toggleStatusLike(1, button)', f.context);
  assert.equal(f.button.dataset.liked, 'true');
  assert.equal(f.count.textContent, 3);
  assert.equal(f.attributes.fill, 'currentColor');
  assert.equal(f.attributes['aria-pressed'], 'true');
  assert.equal(f.button.disabled, true);
  await vm.runInContext('toggleStatusLike(1, button)', f.context);
  assert.equal(calls, 1);
  assert.equal(method, 'POST');
  resolve({ ok: true, json: async () => ({ liked_by_me: true, like_count: 7 }) });
  await pending;
  assert.equal(f.count.textContent, 7);
  assert.equal(f.button.disabled, false);
  assert.equal(f.context.feedItems[0].like_count, 7);

  const unlike = vm.runInContext('toggleStatusLike(1, button)', f.context);
  assert.equal(method, 'DELETE');
  assert.equal(f.count.textContent, 6);
  assert.equal(f.attributes.fill, 'none');
  resolve({ ok: true, json: async () => ({ liked_by_me: false, like_count: 6 }) });
  await unlike;
  assert.equal(f.button.dataset.liked, 'false');
});

test('HTTP and network failures restore count, heart, accessibility state and cached post', async () => {
  for (const fetch of [
    async () => ({ ok: false, json: async () => ({ message: 'Session expired' }) }),
    async () => { throw new Error('Offline'); }
  ]) {
    const f = fixture(fetch);
    await vm.runInContext('toggleStatusLike(1, button)', f.context);
    assert.equal(f.button.dataset.liked, 'false');
    assert.equal(f.count.textContent, 2);
    assert.equal(f.attributes.fill, 'none');
    assert.equal(f.attributes['aria-pressed'], 'false');
    assert.equal(f.classes.has('liked'), false);
    assert.equal(f.button.disabled, false);
    assert.equal(f.context.feedItems[0].like_count, 2);
    assert.equal(f.toasts.length, 1);
  }
});

test('post cards escape text and attributes and reject executable attachment/avatar URLs', () => {
  const { context } = fixture();
  context.post = {
    id: 1, studentId: 'student"&', name: '<img src=x onerror=alert(1)>',
    content: '<script>alert(1)</script>\nSecond line', role: 'student', type: 'assignment',
    avatarUrl: 'javascript:alert(1)', attachment_url: 'data:text/html,test',
    created_at: new Date().toISOString(), liked_by_me: false, like_count: 0, submission_count: 3, canDelete: false
  };
  const output = vm.runInContext('renderPost(post)', context);
  assert.ok(output.includes('&lt;script&gt;alert(1)&lt;/script&gt;\nSecond line'));
  assert.ok(output.includes('@student&quot;&amp;'));
  assert.ok(output.includes('student%22%26'));
  assert.ok(output.includes('3 submitted'));
  assert.ok(output.includes('GU Student'));
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('javascript:'));
  assert.ok(!output.includes('data:text/html'));
  assert.ok(!output.includes('Delete post'));
});


test('renderPost dispatches each feed type and keeps legacy files and Code Lab assignments separate', () => {
  const { context } = fixture();
  vm.runInContext(`
    renderStatusPost = post => 'status:' + post.id;
    renderAssignmentPost = post => 'assignment:' + post.id;
    renderFilePost = post => 'file:' + post.id;
  `, context);
  for (const [post, expected] of [
    [{ id: 1, type: 'status' }, 'status:1'],
    [{ id: 2, type: 'notice' }, 'status:2'],
    [{ id: 3, type: 'assignment' }, 'assignment:3'],
    [{ id: 3, _feedType: 'assignment' }, 'assignment:3'],
    [{ id: 3, originalName: 'Notes.pdf' }, 'file:3']
  ]) {
    context.post = post;
    assert.equal(vm.runInContext('renderPost(post)', context), expected);
  }
});

test('shared post markup uses post actions for assignments and hides submissions on other types', () => {
  const { context } = fixture();
  for (const type of ['status', 'notice', 'assignment']) {
    context.post = {
      id: 8, user_id: 'owner', studentId: 'owner', name: 'Author', role: 'student',
      type, content: 'Class update', created_at: new Date().toISOString(),
      liked_by_me: true, like_count: 4, submission_count: 3, canDelete: true
    };
    const output = vm.runInContext('renderPost(post)', context);
    assert.ok(output.includes('data-post-id="8"'));
    assert.ok(output.includes('toggleStatusLike(8, this)'));
    assert.ok(output.includes('deleteStatusPost(8, this)'));
    assert.ok(output.includes('aria-pressed="true"'));
    assert.ok(output.includes('<span class="like-count">4</span>'));
    assert.equal(output.includes('3 submitted'), type === 'assignment');
    assert.ok(!output.includes('/code-lab/assignment.html'));
  }
});
