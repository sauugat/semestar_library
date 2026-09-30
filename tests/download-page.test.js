const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('download.html exists and contains essential elements', () => {
  const filePath = path.join(__dirname, '..', 'public', 'download.html');
  assert.equal(fs.existsSync(filePath), true, 'public/download.html should exist');

  const content = fs.readFileSync(filePath, 'utf8');
  assert.match(content, /Semester Library/i);
  assert.match(content, /Download for Android/i);
  assert.match(content, /v1\.0\.0/i);
  assert.match(content, /Installation Guide/i);
  assert.match(content, /com\.semesterlibrary\.app/i);
  assert.match(content, /11[26]\s*MB/i);
  assert.match(content, /qrserver\.com/i);
});

test('server.js defines download and apk endpoints', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  assert.match(serverCode, /app\.get\(\['\/download', '\/download\.html', '\/app'\]/);
  assert.match(serverCode, /app\.get\(\['\/download\/apk', '\/api\/download\/apk'/);
  assert.match(serverCode, /LATEST_APK_CDN_URL/);
});
