const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

function upload(base, body, type, filename) {
  const form = new FormData();
  form.append('image', new Blob([body], { type }), filename);
  return fetch(base + '/api/upload', { method: 'POST', body: form });
}

test('upload is saved and served as its image type, whatever the client names it', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t));
  assert.ok(base, 'server did not start');

  const res = await upload(base, '<script>alert(1)</script>', 'image/png', 'evil.html');
  assert.equal(res.status, 200);
  const served = await fetch(base + (await res.json()).url);

  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
});

test('svg upload is rejected and nothing is written', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  const { base } = await boot(t, dir);
  assert.ok(base, 'server did not start');

  const res = await upload(base, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'image/svg+xml', 'x.svg');

  assert.equal(res.ok, false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')), []);
});

test('html already sitting in uploads is served sandboxed', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'legacy.html'), '<script>alert(1)</script>');
  const { base } = await boot(t, dir);
  assert.ok(base, 'server did not start');

  const served = await fetch(base + '/uploads/legacy.html');

  assert.equal(served.headers.get('content-security-policy'), 'sandbox');
});
