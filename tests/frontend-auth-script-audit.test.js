const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Frontend Auth Script Regression Audit: Every page with profile chip or API calls loads /auth.js', () => {
  const publicDir = path.join(__dirname, '../public');
  const htmlFiles = [];

  function collectHtmlFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectHtmlFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlFiles.append ? htmlFiles.append(fullPath) : htmlFiles.push(fullPath);
      }
    }
  }

  collectHtmlFiles(publicDir);
  assert.ok(htmlFiles.length >= 25, 'Expected to find all frontend HTML pages');

  const violations = [];

  for (const filePath of htmlFiles) {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    const hasProfileChip = content.includes('dash-profile-chip');
    const hasHeaderAvatar = content.includes('id="headerAvatar"') || content.includes('id=\'headerAvatar\'');
    const hasApiFetch = (
      content.includes("fetch('/api") ||
      content.includes('fetch("/api') ||
      content.includes('fetch(`/api') ||
      content.includes("safeFetchJson('/api") ||
      content.includes('safeFetchJson("/api')
    );

    const requiresAuthScript = hasProfileChip || hasHeaderAvatar || hasApiFetch;

    if (requiresAuthScript) {
      // Must contain script tag referencing /auth.js (with cache buster ?v=)
      const authScriptRegex = /<script\s+[^>]*src=["']\/(?:js\/)?auth\.js(?:\?[^"']*)?["'][^>]*><\/script>/i;
      const hasAuthScript = authScriptRegex.test(content);

      if (!hasAuthScript) {
        violations.push({
          file: relativePath,
          reason: `Missing /auth.js script tag (hasProfileChip=${hasProfileChip}, hasHeaderAvatar=${hasHeaderAvatar}, hasApiFetch=${hasApiFetch})`
        });
      }

      // If page invokes SemesterAuth directly in inline or subsequent script, confirm /auth.js appears prior to it
      const semesterAuthIndex = content.indexOf('SemesterAuth');
      if (semesterAuthIndex !== -1) {
        const authMatch = content.match(authScriptRegex);
        if (authMatch && authMatch.index !== undefined) {
          assert.ok(
            authMatch.index < semesterAuthIndex,
            `Script load order error in ${relativePath}: /auth.js must load before SemesterAuth is called.`
          );
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `The following HTML pages require /auth.js but do not load it:\n${JSON.stringify(violations, null, 2)}`
  );
});
