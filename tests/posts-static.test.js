const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('uploaded SVG responses keep their sandbox headers even through encoded URLs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'post-static-'));
  const uploads = path.join(directory, 'public', 'uploads', 'posts');
  await fs.mkdir(uploads, { recursive: true });
  await fs.writeFile(path.join(uploads, 'test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const app = express();
  const source = await fs.readFile(require.resolve('../server'), 'utf8');
  const staticSetup = source.slice(source.indexOf('// Serve static assets securely'), source.indexOf('function requireLogin('));
  vm.runInNewContext(staticSetup, { app, express, path, __dirname: directory });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const url of ['/uploads/posts/test.svg', '/uploads%2fposts/test.svg', '/%75ploads/posts/test.svg']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
    assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    await response.text();
  }
});
