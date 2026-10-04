const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { localConfig } = require('../scripts/probe-cohort-realtime.cjs');

function configFile(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cohort-realtime-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'status.json');
  writeFileSync(filename, JSON.stringify({
    API_URL: 'http://127.0.0.1:54321',
    DB_URL: 'postgresql://postgres:fixture@127.0.0.1:54322/postgres',
    ANON_KEY: 'synthetic-fixture-key', JWT_SECRET: 'synthetic-fixture-secret',
    ...overrides,
  }));
  return filename;
}

test('realtime probe accepts explicit loopback fixture configuration without application config', t => {
  const config = localConfig(configFile(t));
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1');
});

test('realtime probe rejects remote database and API destinations before connecting', t => {
  for (const overrides of [
    { DB_URL: 'postgresql://fixture:fixture@production.invalid/database' },
    { API_URL: 'https://production.invalid' },
    { DB_URL: 'postgresql://fixture:fixture@127.0.0.1:54322/postgres?host=production.invalid' },
    { API_URL: 'http://127.0.0.1:54321#unexpected' },
  ]) {
    assert.throws(() => localConfig(configFile(t, overrides)), /127\.0\.0\.1/);
  }
});

test('realtime probe refuses missing credentials instead of loading .env', t => {
  assert.throws(() => localConfig(configFile(t, { JWT_SECRET: '' })), /credentials are missing/);
});
