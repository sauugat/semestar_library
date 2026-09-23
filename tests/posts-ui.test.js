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
    functionSection('    function formatSize(', '    function showToast('),
    functionSection('    function renderFilePost(', '    function renderAssignmentPost('),
    functionSection('    async function toggleLike(', '    async function toggleCommentPanel('),
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
  // Student role: no @handle, no GU Student badge
  assert.ok(!output.includes('@student&quot;&amp;'));
  assert.ok(output.includes('student%22%26'));
  assert.ok(output.includes('3 submitted'));
  assert.ok(!output.includes('GU Student'));
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('javascript:'));
  assert.ok(!output.includes('data:text/html'));
  assert.ok(!output.includes('Delete post'));

  // Admin role: shows @handle and Admin badge and notice border
  context.post = {
    id: 2, studentId: 'admin"&', name: 'Admin User',
    content: 'Admin announcement', role: 'admin', type: 'notice',
    created_at: new Date().toISOString(), liked_by_me: false, like_count: 0, canDelete: false
  };
  const adminOutput = vm.runInContext('renderPost(post)', context);
  assert.ok(adminOutput.includes('@admin&quot;&amp;'));
  assert.ok(adminOutput.includes('Admin'));
  assert.ok(adminOutput.includes('notice'));
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

test('uploaded images render below content and above actions; text-only posts omit the image block', () => {
  const { context } = fixture();
  context.post = {
    id: 2, studentId: 'owner', name: 'Author', content: 'A class photo', type: 'status',
    role: 'student', created_at: new Date().toISOString(), like_count: 0, liked_by_me: false,
    attachment_url: '/uploads/posts/photo.png'
  };
  const output = vm.runInContext('renderPost(post)', context);
  assert.match(output, /<div class="post-image"><img src="https:\/\/example.com\/uploads\/posts\/photo.png"/);
  assert.ok(output.indexOf('A class photo') < output.indexOf('<div class="post-image">'));
  assert.ok(output.indexOf('<div class="post-image">') < output.indexOf('<footer'));
  context.post.attachment_url = null;
  assert.ok(!vm.runInContext('renderPost(post)', context).includes('<div class="post-image">'));
});

test('Code Lab assignments preserve the Lab embed, badges, question counts and links', () => {
  const { context } = fixture();
  context.localStorage = { getItem: () => null };
  context.assignment = {
    id: 7, title: 'Arrays', createdBy: 'faculty', teacherName: 'Teacher',
    createdAt: new Date().toISOString(), questionCount: 3, submissionCount: 12,
    mySubmissionCount: 1, subject: 'C', semester: 'II', canDelete: true
  };
  const output = vm.runInContext('renderAssignmentPost(assignment)', context);
  for (const expected of ['file-attachment', '<span>LAB</span>', 'post-admin-badge',
    '3 Problems', '12 Submitted', '1/3 Submitted', '/code-lab/assignment.html?id=7',
    '/code-lab/submissions.html?id=7', 'deleteAssignmentPost(7, this, event)']) {
    assert.ok(output.includes(expected), expected);
  }
  assert.ok(!output.includes('post-image'));
});

function composerFixture(fetch) {
  const elements = {};
  for (const id of ['postImageInput', 'postImagePreview', 'postImagePreviewImg', 'choosePostImage',
    'removePostImage', 'postComposerMessage', 'postComposer', 'postContent', 'postType', 'publishPost']) {
    elements[id] = {
      value: '', files: [], hidden: true, disabled: false, textContent: '', events: {},
      addEventListener(event, handler) { this.events[event] = handler; },
      removeAttribute(name) { delete this[name]; },
      click() {}, focus() {}
    };
  }
  Object.defineProperty(elements.postImageInput, 'value', {
    get: () => '', set: () => { elements.postImageInput.files = []; }
  });
  const revoked = [];
  const added = [];
  let rendered = 0;
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL: url => revoked.push(url) },
    FormData, fetch, feedReady: Promise.resolve(),
    addFeedPosts: posts => added.push(...posts), renderFeed: () => { rendered++; }
  });
  vm.runInContext(functionSection('    const postImageInput =', '    const pendingPostLikes ='), context);
  elements.postContent.value = 'Class update';
  elements.postType.value = 'status';
  return {
    elements, revoked, added, get rendered() { return rendered; },
    select: file => { elements.postImageInput.files = [file]; elements.postImageInput.events.change(); },
    submit: () => elements.postComposer.events.submit({ preventDefault() {} })
  };
}

test('image selection previews, replacement revokes the old URL, and remove clears the file', () => {
  const f = composerFixture();
  f.select(new File(['a'], 'one.png', { type: 'image/png' }));
  assert.equal(f.elements.postImagePreview.hidden, false);
  assert.equal(f.elements.postImagePreviewImg.src, 'blob:one.png');
  f.select(new File(['b'], 'two.png', { type: 'image/png' }));
  assert.deepEqual(f.revoked, ['blob:one.png']);
  f.elements.removePostImage.events.click();
  assert.equal(f.elements.postImageInput.files.length, 0);
  assert.equal(f.elements.postImagePreview.hidden, true);
  assert.equal(f.elements.postImagePreviewImg.src, undefined);
  assert.deepEqual(f.revoked, ['blob:one.png', 'blob:two.png']);
  f.select(new File(['bad'], 'bad.txt', { type: 'text/plain' }));
  assert.equal(f.elements.postImagePreview.hidden, true);
  assert.match(f.elements.postComposerMessage.textContent, /image file/);
  f.select(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
  assert.match(f.elements.postComposerMessage.textContent, /5 MB/);
});

test('composer sends multipart with or without an image and clears only after success', async () => {
  for (const withImage of [false, true]) {
    let request;
    const f = composerFixture(async (url, options) => {
      request = { url, ...options };
      return { ok: true, json: async () => ({ id: 5, content: 'Class update', type: 'status' }) };
    });
    if (withImage) f.select(new File(['photo'], 'photo.png', { type: 'image/png' }));
    await f.submit();
    assert.equal(request.url, '/api/posts');
    assert.equal(request.headers, undefined);
    assert.ok(request.body instanceof FormData);
    assert.equal(request.body.get('content'), 'Class update');
    assert.equal(request.body.get('type'), 'status');
    assert.equal(request.body.has('image'), withImage);
    assert.equal(f.elements.postContent.value, '');
    assert.equal(f.elements.postImageInput.files.length, 0);
    assert.equal(f.elements.postImagePreview.hidden, true);
    assert.equal(f.elements.publishPost.disabled, false);
    assert.equal(f.added[0].id, 5);
    assert.equal(f.rendered, 1);
  }
});

test('failed image posts retain draft and selection so the user can retry', async () => {
  const f = composerFixture(async () => ({ ok: false, json: async () => ({ message: 'Upload failed' }) }));
  f.select(new File(['photo'], 'photo.png', { type: 'image/png' }));
  await f.submit();
  assert.equal(f.elements.postContent.value, 'Class update');
  assert.equal(f.elements.postImageInput.files.length, 1);
  assert.equal(f.elements.postImagePreview.hidden, false);
  assert.equal(f.elements.postImagePreviewImg.src, 'blob:photo.png');
  assert.equal(f.elements.postComposerMessage.textContent, 'Upload failed');
  assert.equal(f.elements.choosePostImage.disabled, false);
  assert.equal(f.elements.publishPost.disabled, false);
  assert.equal(f.added.length, 0);
  assert.deepEqual(f.revoked, []);
});


test('PDF and spreadsheet resources share actions and show one filename with working file links', () => {
  const { context } = fixture();
  for (const extension of ['pdf', 'xlsx']) {
    context.file = { id: 12, originalName: `Long_resource_name.${extension}`, title: `Long_resource_name.${extension}`,
      uploaderName: 'Teacher', uploaderRole: 'teacher', uploadedBy: 'faculty', uploadedAt: new Date().toISOString(),
      sizeBytes: 2048, subject: 'Web Technology I', chapter: 'PYQS', likeCount: 5, commentCount: 2 };
    const output = vm.runInContext('renderPost(file)', context);
    assert.equal(output.split(`>Long_resource_name.${extension}<`).length - 1, 1);
    assert.ok(output.includes(`title="Long_resource_name.${extension}"`));
    assert.ok(output.includes(`<span>${extension.toUpperCase()}</span>`));
    assert.ok(output.includes('class="post-actions post-footer"'));
    assert.ok(output.includes('/api/files/12/view'));
    assert.ok(output.includes('/api/files/12/download'));
    assert.ok(output.includes('toggleCommentPanel(12,'));
    assert.ok(output.includes('copyPostLink(12)'));
    assert.ok(!output.includes('<span>Share</span>'));
    assert.ok(!output.includes('attachment-name'));
  }
});

test('resource like failures roll back the count, heart and accessible state', async () => {
  const f = fixture(async () => ({ ok: false, json: async () => ({ message: 'Please sign in' }) }));
  await vm.runInContext('toggleLike(12, button)', f.context);
  assert.equal(f.button.dataset.liked, 'false');
  assert.equal(f.count.textContent, 2);
  assert.equal(f.attributes.fill, 'none');
  assert.equal(f.attributes['aria-pressed'], 'false');
  assert.equal(f.button.disabled, false);
});
