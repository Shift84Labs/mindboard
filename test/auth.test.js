const test = require('node:test');
const assert = require('node:assert');
const { tmpDataDir, boot } = require('./helpers');

const HEADER = 'x-auth-request-email';

test('without AUTH_MODE the board needs no login', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t));
  assert.equal((await fetch(base + '/api/notes')).status, 200);
  const me = await (await fetch(base + '/api/me')).json();
  assert.equal(me.mode, 'none');
  assert.equal(me.authenticated, true);
  assert.equal(me.user.id, 'local');
});

test('health check answers without auth', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), {
    AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '10.0.0.0/8',
  });
  const res = await fetch(base + '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', auth: 'proxy' });
});

test('proxy mode accepts the header from a trusted proxy', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), {
    AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '127.0.0.1/32',
  });
  assert.equal((await fetch(base + '/api/notes')).status, 401);

  const signed = { headers: { [HEADER]: 'Brent@example.test' } };
  assert.equal((await fetch(base + '/api/notes', signed)).status, 200);
  const me = await (await fetch(base + '/api/me', signed)).json();
  assert.equal(me.authenticated, true);
  assert.equal(me.user.email, 'brent@example.test');
  assert.equal(me.user.role, 'admin', 'first user in is the admin');
});

test('proxy mode ignores the header from an untrusted address', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), {
    AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '10.0.0.0/8',
  });
  const res = await fetch(base + '/api/notes', { headers: { [HEADER]: 'attacker@example.test' } });
  assert.equal(res.status, 401, 'tests connect from 127.0.0.1, which is not trusted here');
});

test('proxy mode refuses to start without a trusted proxy list', { timeout: 10000 }, async (t) => {
  const result = await boot(t, tmpDataDir(t), { AUTH_MODE: 'proxy' });
  assert.equal(result.exitCode, 1);
});

test('oidc mode refuses to start without its settings', { timeout: 10000 }, async (t) => {
  const result = await boot(t, tmpDataDir(t), { AUTH_MODE: 'oidc', OIDC_ISSUER_URL: 'https://id.example.test' });
  assert.equal(result.exitCode, 1);
});

test('an unknown AUTH_MODE refuses to start', { timeout: 10000 }, async (t) => {
  const result = await boot(t, tmpDataDir(t), { AUTH_MODE: 'password' });
  assert.equal(result.exitCode, 1);
});

test('writes driven by another site are refused', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t));
  const body = JSON.stringify({ title: 'x' });
  const headers = { 'Content-Type': 'application/json' };

  const crossSite = await fetch(base + '/api/notes', {
    method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body,
  });
  assert.equal(crossSite.status, 403);

  const sameSite = await fetch(base + '/api/notes', {
    method: 'POST', headers: { ...headers, Origin: base }, body,
  });
  assert.equal(sameSite.status, 200);
});
