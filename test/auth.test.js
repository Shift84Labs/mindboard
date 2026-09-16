const test = require('node:test');
const assert = require('node:assert');
const { tmpDataDir, boot } = require('./helpers');
const { upsertUser } = require('../auth');

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

test('emails that differ only in punctuation are different users', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), {
    AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '127.0.0.1/32',
  });
  const me = async (email) => (await (await fetch(base + '/api/me', { headers: { [HEADER]: email } })).json()).user;
  const plus = await me('a+b@example.test');
  const underscore = await me('a_b@example.test');
  assert.notEqual(plus.id, underscore.id);
});

function memoryStore(users) {
  const db = { users };
  return { db, getDb: () => db, save: () => {} };
}

test('an OIDC login with an unverified email cannot take over an existing account', () => {
  const store = memoryStore([
    { id: 'owner1', subject: 'sub-owner', email: 'brent@example.test', displayName: 'Brent', role: 'admin' },
    { id: 'proxy1', subject: null, email: 'sarah@example.test', displayName: 'Sarah', role: 'user' },
  ]);
  const a = upsertUser(store, { subject: 'sub-attacker', email: 'brent@example.test', emailVerified: true });
  const b = upsertUser(store, { subject: 'sub-attacker2', email: 'sarah@example.test', emailVerified: false });
  assert.notEqual(a.id, 'owner1', 'a verified email must not override an account that has its own subject');
  assert.notEqual(b.id, 'proxy1', 'an unverified email must not claim a proxy-created account');
  assert.equal(store.db.users.length, 4);
});

test('an OIDC login with a verified email links the matching proxy-created account', () => {
  const store = memoryStore([
    { id: 'proxy1', subject: null, email: 'brent@example.test', displayName: 'Brent', role: 'admin' },
  ]);
  const user = upsertUser(store, { subject: 'sub-brent', email: 'Brent@Example.test', emailVerified: true });
  assert.equal(user.id, 'proxy1');
  assert.equal(store.db.users[0].subject, 'sub-brent');
  assert.equal(upsertUser(store, { subject: 'sub-brent', email: 'new@example.test' }).id, 'proxy1', 'later logins match by subject');
});
