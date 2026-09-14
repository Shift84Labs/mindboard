const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDataDir, boot } = require('./helpers');

const XSS = '"><img src=x onerror=alert(1)>';

async function start(t) {
  const { base, exitCode } = await boot(t, tmpDataDir(t));
  assert.ok(base, `server exited with ${exitCode}`);
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test('writes shaped like the UI sends them are accepted', { timeout: 10000 }, async (t) => {
  const call = await start(t);

  const tag = await call('POST', '/api/tags', { name: 'work', color: '#60a5fa' });
  assert.equal(tag.status, 200);
  const note = await call('POST', '/api/notes', {
    title: 'Plan', text: 'body', checklist: [{ text: 'step', done: false }], tags: [tag.body.id],
    color: '#4ade80', textColor: '', images: [], pinned: false,
    reminder: { at: '2026-09-15T13:00:00.000Z', freq: 'weekly', enabled: true },
  });
  assert.equal(note.status, 200);
  // the note editor PUTs its whole working copy back, server-owned fields included
  const edited = { ...note.body, pinned: true, reminder: null, images: ['/uploads/0123456789abcdef.jpeg'] };
  assert.equal((await call('PUT', `/api/notes/${note.body.id}`, edited)).status, 200);
  assert.equal((await call('PUT', `/api/tags/${tag.body.id}`, { color: '#229ED9', pinned: true })).status, 200);
  const widget = await call('POST', '/api/widgets', { type: 'quizProg', x: 20, y: 20, w: 320, h: 220, config: {} });
  assert.equal(widget.status, 200);
  assert.equal((await call('PUT', `/api/widgets/${widget.body.id}`, { x: 40, y: 60, w: 340, h: 240, z: 2 })).status, 200);
  const rem = await call('POST', '/api/reminders', { text: 'call', at: '2026-09-15T13:00:00.000Z', freq: 'daily' });
  assert.equal(rem.status, 200);
  assert.equal((await call('PUT', `/api/reminders/${rem.body.id}`, { enabled: false })).status, 200);
});

test('writes with the wrong shape are rejected with 400 and change nothing', { timeout: 10000 }, async (t) => {
  const call = await start(t);
  const tag = (await call('POST', '/api/tags', { name: 'work' })).body;
  const note = (await call('POST', '/api/notes', { title: 'keep' })).body;
  const widget = (await call('POST', '/api/widgets', { type: 'clock' })).body;
  const rem = (await call('POST', '/api/reminders', { text: 'call', at: '2026-09-15T13:00:00.000Z' })).body;
  const snapshot = () => Promise.all(['/api/notes', '/api/tags', '/api/widgets', '/api/reminders'].map(async (u) => (await call('GET', u)).body));
  const before = await snapshot();

  const bad = [
    ['POST', '/api/notes', ['not', 'an', 'object']],
    ['POST', '/api/notes', { text: 123 }],
    ['POST', '/api/notes', { tags: 'notarray' }],
    ['POST', '/api/notes', { images: ['/uploads/0123456789abcdef.png' + XSS] }],
    ['POST', '/api/notes', { reminder: { at: '2026-09-15T13:00:00.000Z', freq: '<b>', enabled: true } }],
    ['PUT', `/api/notes/${note.id}`, { checklist: 'notarray' }],
    ['PUT', `/api/notes/${note.id}`, { color: 'red' + XSS }],
    ['POST', '/api/tags', { name: 'x', color: 'red' + XSS }],
    ['PUT', `/api/tags/${tag.id}`, { color: 'red' + XSS }],
    ['POST', '/api/widgets', { type: XSS }],
    ['PUT', `/api/widgets/${widget.id}`, { config: 'notobject' }],
    ['PUT', `/api/widgets/${widget.id}`, { x: '20px' }],
    ['POST', '/api/reminders', { text: 'call', at: '2026-09-15T13:00:00.000Z', freq: '<b>' }],
    ['PUT', `/api/reminders/${rem.id}`, { at: 'not a date' }],
  ];
  for (const [method, url, body] of bad) {
    assert.equal((await call(method, url, body)).status, 400, `${method} ${url} ${JSON.stringify(body)}`);
  }
  assert.deepEqual(await snapshot(), before);
});
