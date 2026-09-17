const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

const PROXY = { AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '127.0.0.1/32' };
const ADMIN = 'brent@example.test';
const OTHER = 'sarah@example.test';
const T0 = '2026-01-01T00:00:00.000Z';

// fetch as a signed-in user (the proxy header), returning { status, body }
function as(base, email) {
  return async (method, url, body) => {
    const opts = { method, headers: { 'x-auth-request-email': email } };
    if (body instanceof FormData) opts.body = body;
    else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, opts);
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

function uploadForm() {
  const form = new FormData();
  form.append('image', new Blob(['png bytes'], { type: 'image/png' }), 'photo.png');
  return form;
}

const note = (id, extra) => ({
  id, title: id, text: '', checklist: [], tags: [], color: '', textColor: '', images: [], pinned: false,
  reminder: null, createdAt: T0, updatedAt: T0, ...extra,
});

function seed(dir, data) {
  const raw = JSON.stringify({ notes: [], tags: [], widgets: [], settings: {}, reminders: [], ...data });
  fs.writeFileSync(path.join(dir, 'db.json'), raw);
  return raw;
}

const backups = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('db.json.bak'));

test("another user's notes, tags, widgets and reminders are invisible and untouchable", { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  const admin = as(base, ADMIN);
  const other = as(base, OTHER);

  const tag = (await admin('POST', '/api/tags', { name: 'work' })).body;
  const created = {
    notes: (await admin('POST', '/api/notes', { title: 'mine', tags: [tag.id] })).body,
    tags: tag,
    widgets: (await admin('POST', '/api/widgets', { type: 'clock' })).body,
    reminders: (await admin('POST', '/api/reminders', { text: 'mine', at: '2030-01-01T00:00:00.000Z' })).body,
  };
  const edits = { notes: { title: 'stolen' }, tags: { name: 'stolen' }, widgets: { x: 999 }, reminders: { text: 'stolen' } };

  for (const [kind, row] of Object.entries(created)) {
    assert.deepEqual((await other('GET', `/api/${kind}`)).body, [], `${kind} leaked to another user`);
    assert.equal((await other('PUT', `/api/${kind}/${row.id}`, edits[kind])).status, 404, `${kind} update`);
    await other('DELETE', `/api/${kind}/${row.id}`);
  }

  for (const [kind, row] of Object.entries(created)) {
    assert.deepEqual((await admin('GET', `/api/${kind}`)).body, [row], `${kind} changed by another user`);
  }
});

test('each user has their own tag names', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  assert.equal((await as(base, ADMIN)('POST', '/api/tags', { name: 'work' })).status, 200);
  assert.equal((await as(base, OTHER)('POST', '/api/tags', { name: 'work' })).status, 200);
  assert.equal((await as(base, OTHER)('POST', '/api/tags', { name: 'work' })).status, 409);
});

test('an upload is served only to its owner', { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  const { url } = (await as(base, ADMIN)('POST', '/api/upload', uploadForm())).body;

  const own = await as(base, ADMIN)('GET', url);
  assert.equal(own.status, 200);
  assert.equal(own.body, 'png bytes');
  assert.equal((await as(base, OTHER)('GET', url)).status, 404);
});

test("deleting a note cannot remove another user's image", { timeout: 10000 }, async (t) => {
  const { base } = await boot(t, tmpDataDir(t), PROXY);
  const { url } = (await as(base, ADMIN)('POST', '/api/upload', uploadForm())).body;

  const other = as(base, OTHER);
  const bait = (await other('POST', '/api/notes', { images: [url] })).body;
  await other('DELETE', `/api/notes/${bait.id}`);
  await new Promise((r) => setTimeout(r, 200)); // image removal is asynchronous

  assert.equal((await as(base, ADMIN)('GET', url)).status, 200);
});

test('legacy data belongs to the admin after the upgrade, and db.json is backed up first', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'aaaaaaaaaaaaaaaa.png'), 'legacy image');
  const original = seed(dir, {
    users: [{ id: 'admin-id', subject: null, email: ADMIN, displayName: ADMIN, role: 'admin', createdAt: T0 }],
    notes: [note('n1', { images: ['/uploads/aaaaaaaaaaaaaaaa.png'] }), note('n2', { ownerId: 'local' })],
    tags: [{ id: 'bbbbbbbbbbbbbbbb', name: 'OLD', color: '', pinned: false }],
    widgets: [{ id: 'w1', type: 'clock', x: 0, y: 0, w: 100, h: 100, z: 1, config: {} }],
    reminders: [{ id: 'r1', text: 'old', at: '2030-01-01T00:00:00.000Z', freq: 'once', enabled: true }],
  });
  const { base, exitCode } = await boot(t, dir, PROXY);
  assert.ok(base, `server exited with ${exitCode}`);

  const admin = as(base, ADMIN);
  const other = as(base, OTHER);
  assert.deepEqual((await admin('GET', '/api/notes')).body.map((n) => n.id), ['n1', 'n2']);
  for (const kind of ['tags', 'widgets', 'reminders']) {
    assert.equal((await admin('GET', `/api/${kind}`)).body.length, 1, `admin lost legacy ${kind}`);
    assert.deepEqual((await other('GET', `/api/${kind}`)).body, [], `legacy ${kind} leaked`);
  }
  assert.deepEqual((await other('GET', '/api/notes')).body, []);
  assert.equal((await admin('GET', '/uploads/aaaaaaaaaaaaaaaa.png')).status, 200);
  assert.equal((await other('GET', '/uploads/aaaaaaaaaaaaaaaa.png')).status, 404);

  const [backup] = backups(dir);
  assert.ok(backup, 'no backup was written before the migration');
  assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), original);
});

test('legacy data waits for the first sign-in when no user exists yet', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  seed(dir, { notes: [note('n1')] });
  const { base, exitCode } = await boot(t, dir, PROXY);
  assert.ok(base, `server exited with ${exitCode}`);

  assert.deepEqual((await as(base, ADMIN)('GET', '/api/notes')).body.map((n) => n.id), ['n1']);
  assert.deepEqual((await as(base, OTHER)('GET', '/api/notes')).body, []);
});

test('without AUTH_MODE every note stays on the board and db.json is not migrated', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  const original = seed(dir, { notes: [note('n1'), note('n2', { ownerId: 'some-user' })] });
  const { base, exitCode } = await boot(t, dir);
  assert.ok(base, `server exited with ${exitCode}`);

  const notes = await (await fetch(base + '/api/notes')).json();
  assert.deepEqual(notes.map((n) => n.id), ['n1', 'n2']);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), original);
  assert.deepEqual(backups(dir), []);
});
