const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDataDir, boot } = require('./helpers');
const { version } = require('../package.json');

const PROXY = { AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '127.0.0.1/32' };

// fetch as a signed-in user (the proxy header), returning { status, body }
function as(base, email) {
  return async (method, url, body) => {
    const opts = { method, headers: { 'x-auth-request-email': email } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, opts);
    return { status: res.status, body: await res.json() };
  };
}

test('preferences are stored per user, not per browser', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  const brent = as(base, 'brent@example.test');
  const sarah = as(base, 'sarah@example.test');

  assert.deepEqual((await brent('GET', '/api/prefs')).body, { theme: 'dark', font: 'roboto', ui: 'auto' });
  assert.equal((await brent('PUT', '/api/prefs', { theme: 'light', font: 'mono' })).status, 200);

  // a second request carries nothing from the first, like a phone after the desktop changed the theme
  assert.deepEqual((await brent('GET', '/api/prefs')).body, { theme: 'light', font: 'mono', ui: 'auto' });
  assert.deepEqual((await sarah('GET', '/api/prefs')).body, { theme: 'dark', font: 'roboto', ui: 'auto' });
});

test('a preference outside its allowed values is refused', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  const brent = as(base, 'brent@example.test');
  for (const bad of [{ theme: 'blue' }, { font: 'comic' }, { ui: 'tablet' }, { theme: 1 }]) {
    assert.equal((await brent('PUT', '/api/prefs', bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual((await brent('GET', '/api/prefs')).body, { theme: 'dark', font: 'roboto', ui: 'auto' });
});

test('without sign-in the single board keeps its preferences', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t));
  const put = await fetch(base + '/api/prefs', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ui: 'desktop' }),
  });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await fetch(base + '/api/prefs')).json(), { theme: 'dark', font: 'roboto', ui: 'desktop' });
});

test("status reports the deployed build, Telegram, and only the caller's counts", { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), { ...PROXY, APP_COMMIT: 'abc1234' });
  const brent = as(base, 'brent@example.test');
  const sarah = as(base, 'sarah@example.test');
  await brent('POST', '/api/notes', { title: 'one' });
  await sarah('POST', '/api/notes', { title: 'two' });
  await sarah('POST', '/api/tags', { name: 'hers' });

  const { status, body } = await brent('GET', '/api/status');
  assert.equal(status, 200);
  assert.equal(body.version, version);
  assert.equal(body.commit, 'abc1234');
  assert.equal(body.telegram.status, 'disabled');
  assert.deepEqual(body.counts, { notes: 1, tags: 0, widgets: 0, reminders: 0, uploads: 0 });
});
