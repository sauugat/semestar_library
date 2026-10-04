const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProofConfig, probeV2 } = require('../scripts/probe-cohort-realtime-v2.cjs');

const fixture = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: 'postgresql://postgres:fixture@127.0.0.1:54322/postgres',
  ANON_KEY: 'fixture-public', JWT_SECRET: 'fixture-signer', SERVICE_ROLE_KEY: 'fixture-server',
};

test('V2 rejects remote and URL override destinations before creating any client', async () => {
  for (const overrides of [
    { API_URL: 'https://production.invalid' },
    { DB_URL: 'postgresql://postgres:fixture@production.invalid/postgres' },
    { DB_URL: fixture.DB_URL + '?host=production.invalid' },
    { API_URL: 'http://secret@127.0.0.1:54321' },
    { API_URL: 'ftp://127.0.0.1:54321' },
    { DB_URL: 'https://127.0.0.1:54322/postgres' },
  ]) await assert.rejects(() => probeV2({ ...fixture, ...overrides }), /disposable loopback/);
});

test('V2 requires explicit local credentials with no application environment fallback', () => {
  for (const name of ['ANON_KEY', 'JWT_SECRET', 'SERVICE_ROLE_KEY']) {
    assert.throws(() => validateProofConfig({ ...fixture, [name]: '' }), /Missing disposable credential/);
  }
  assert.equal(validateProofConfig(fixture), fixture);
});
