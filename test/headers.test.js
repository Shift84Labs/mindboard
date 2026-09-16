const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDataDir, boot } = require('./helpers');

async function fetchFromServer(t, url) {
  const { base, exitCode } = await boot(t, tmpDataDir(t));
  assert.ok(base, `server exited with ${exitCode}`);
  return fetch(base + url);
}

test('pages only allow same-origin scripts', { timeout: 10000 }, async (t) => {
  const res = await fetchFromServer(t, '/');
  const policy = res.headers.get('content-security-policy') || '';
  const scriptSrc = policy.split(';').map((d) => d.trim().split(/\s+/)).find(([name]) => name === 'script-src');
  assert.deepEqual(scriptSrc, ['script-src', "'self'"]);
});

test('pages refuse to be framed by other sites', { timeout: 10000 }, async (t) => {
  const res = await fetchFromServer(t, '/');
  const policy = res.headers.get('content-security-policy') || '';
  const frameAncestors = policy.split(';').map((d) => d.trim().split(/\s+/)).find(([name]) => name === 'frame-ancestors');
  assert.deepEqual(frameAncestors, ['frame-ancestors', "'none'"]);
});

test('responses do not advertise Express', { timeout: 10000 }, async (t) => {
  const res = await fetchFromServer(t, '/api/notes');
  assert.equal(res.headers.get('x-powered-by'), null);
});
