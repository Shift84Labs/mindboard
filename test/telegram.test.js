const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { tmpDataDir, boot, freePort } = require('./helpers');

const OWNER = 111;
const STRANGER = 999;

// Minimal stand-in for the Bot API: hands out the queued updates once (more can be pushed
// while the server runs), records every sendMessage and answers each send with sendResult.
async function fakeTelegram(t, { updates = [], sendResult = { ok: true, result: {} } } = {}) {
  const sent = [];
  let pending = updates;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.url.startsWith('/file/')) return res.end('photo bytes');
      const method = req.url.split('/').pop();
      const reply = (body) => res.end(JSON.stringify(body));
      if (method === 'getMe') return reply({ ok: true, result: { username: 'fake_bot' } });
      if (method === 'getUpdates') {
        const result = pending;
        pending = [];
        return setTimeout(() => reply({ ok: true, result }), result.length ? 0 : 100);
      }
      if (method === 'getFile') return reply({ ok: true, result: { file_id: 'photo1', file_path: 'photos/file_1.jpg' } });
      if (method === 'sendMessage') {
        sent.push(JSON.parse(raw));
        return reply(sendResult);
      }
      reply({ ok: false, description: `unexpected ${method}` });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, sent, push: (u) => pending.push(u) };
}

function botEnv(tg) {
  return { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url, TELEGRAM_ALLOWED_CHAT_ID: String(OWNER) };
}

// nothing listens on a port that was just released, so every Bot API call is refused
async function unreachableEnv() {
  return { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: `http://127.0.0.1:${await freePort()}` };
}

function seedDb(dir, data) {
  const db = { notes: [], tags: [], widgets: [], settings: {}, reminders: [], ...data };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
}

async function telegramStatus(base, opts = {}) {
  const res = await fetch(base + '/api/telegram', opts).catch(() => null);
  return res && res.ok ? res.json() : null;
}

// performance.now(), not Date.now(): a wall clock that jumps (WSL2 does, by 10 s) ends the wait early
async function waitFor(check, ms = 5000) {
  for (const end = performance.now() + ms; performance.now() < end; ) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test('with TELEGRAM_ALLOWED_CHAT_ID set, a stranger who messages first cannot post to the board', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t, {
    updates: [
      { update_id: 1, message: { chat: { id: STRANGER }, date: 1, text: 'from stranger' } },
      { update_id: 2, message: { chat: { id: OWNER }, date: 2, text: 'from owner' } },
    ],
  });
  const { base, exitCode } = await boot(t, tmpDataDir(t), botEnv(tg));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 2), 'the bridge did not answer both chats');
  const notes = await (await fetch(base + '/api/notes')).json();
  assert.deepEqual(notes.map((n) => n.text), ['from owner']);
});

test('stored markup in reminders reaches Telegram escaped', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const dir = tmpDataDir(t);
  const due = '2026-01-01T00:00:00.000Z';
  seedDb(dir, {
    tags: [{ id: 'aaaaaaaaaaaaaaaa', name: '<A HREF="HTTPS://EVIL.EXAMPLE">X</A>', color: '', pinned: false }],
    notes: [{
      id: 'bbbbbbbbbbbbbbbb', title: 'pay rent', text: '', checklist: [], tags: ['aaaaaaaaaaaaaaaa'], color: '', textColor: '',
      images: [], pinned: false, reminder: { at: due, freq: 'once', enabled: true }, createdAt: due, updatedAt: due,
    }],
    // saved before reminder frequencies were validated
    reminders: [{ id: 'cccccccccccccccc', text: 'water plants', at: due, freq: '<i>weekly</i>', enabled: true }],
    settings: { telegramChats: [OWNER] },
  });
  const { base, exitCode } = await boot(t, dir, botEnv(tg));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 2), 'both due reminders were not sent');
  const all = tg.sent.map((m) => m.text).join('\n');
  assert.ok(!all.includes('<A HREF') && !all.includes('<i>'), `raw markup reached Telegram:\n${all}`);
  assert.ok(all.includes('#&lt;A HREF') && all.includes('repeats &lt;i&gt;weekly&lt;/i&gt;'), `markup was dropped instead of escaped:\n${all}`);
});

test('a reminder whose Telegram send fails stays due so the next check retries it', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t, { sendResult: { ok: false, error_code: 502, description: 'Bad Gateway' } });
  const dir = tmpDataDir(t);
  seedDb(dir, {
    reminders: [{ id: 'cccccccccccccccc', text: 'take meds', at: '2026-01-01T00:00:00.000Z', freq: 'once', enabled: true }],
    settings: { telegramChats: [OWNER] },
  });
  const { base, exitCode } = await boot(t, dir, botEnv(tg));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 1), 'the reminder was never sent');
  await new Promise((r) => setTimeout(r, 300)); // give the server time to handle the rejection
  const [rem] = await (await fetch(base + '/api/reminders')).json();
  assert.equal(rem.enabled, true);
});

test('an unreachable Bot API at startup does not take the board down', { timeout: 15000 }, async (t) => {
  const { base, exitCode } = await boot(t, tmpDataDir(t), await unreachableEnv());
  assert.ok(base, `server exited with ${exitCode}`);

  await new Promise((r) => setTimeout(r, 1500)); // a refused getMe fails within milliseconds
  const res = await fetch(base + '/api/notes').catch(() => null);
  assert.ok(res && res.ok, 'the server stopped answering once the Bot API was unreachable');
});

test('the board reports Telegram as disconnected, with a reason, while the Bot API is unreachable', { timeout: 15000 }, async (t) => {
  const { base, exitCode } = await boot(t, tmpDataDir(t), await unreachableEnv());
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(async () => (await telegramStatus(base))?.status === 'disconnected'), 'status never became disconnected');
  assert.ok((await telegramStatus(base)).detail, 'disconnected without a reason');
});

test('the board reports Telegram as connected once the Bot API answers', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const { base, exitCode } = await boot(t, tmpDataDir(t), botEnv(tg));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(async () => (await telegramStatus(base))?.status === 'connected'), 'status never became connected');
});

test('without a bot token the board reports Telegram as disabled', { timeout: 15000 }, async (t) => {
  const { base, exitCode } = await boot(t, tmpDataDir(t));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.equal((await telegramStatus(base))?.status, 'disabled');
});

// Until Telegram is mapped per user, the bridge serves the admin's board only
const PROXY = { AUTH_MODE: 'proxy', AUTH_TRUSTED_PROXIES: '127.0.0.1/32' };
const USERS = [
  { id: 'admin-id', subject: null, email: 'brent@example.test', displayName: 'Brent', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'other-id', subject: null, email: 'sarah@example.test', displayName: 'Sarah', role: 'user', createdAt: '2026-01-01T00:00:00.000Z' },
];
const signedIn = (email) => ({ headers: { 'x-auth-request-email': email, 'Content-Type': 'application/json' } });

test('a Telegram message lands on the admin board only', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t, { updates: [{ update_id: 1, message: { chat: { id: OWNER }, date: 1, text: 'from owner' } }] });
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS });
  const { base, exitCode } = await boot(t, dir, { ...botEnv(tg), ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 1), 'the bridge did not confirm the message');
  const notes = async (email) => (await (await fetch(base + '/api/notes', signedIn(email))).json()).map((n) => n.text);
  assert.deepEqual(await notes('brent@example.test'), ['from owner']);
  assert.deepEqual(await notes('sarah@example.test'), []);
});

test("another user's reminders are not sent to the admin's Telegram chat", { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const dir = tmpDataDir(t);
  const due = '2026-01-01T00:00:00.000Z';
  seedDb(dir, {
    users: USERS,
    // the scheduler walks these in order, so the other user's would be sent first
    reminders: [
      { id: 'cccccccccccccccc', text: 'sarah private', at: due, freq: 'once', enabled: true, ownerId: 'other-id' },
      { id: 'dddddddddddddddd', text: 'brent reminder', at: due, freq: 'once', enabled: true, ownerId: 'admin-id' },
    ],
  });
  const { base, exitCode } = await boot(t, dir, { ...botEnv(tg), ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 1), 'the admin reminder was never sent');
  assert.deepEqual(tg.sent.map((m) => m.text), ['⏰ <b>brent reminder</b>']);
});

test("another user's timer alert is not sent to the admin's Telegram chat", { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS });
  const { base, exitCode } = await boot(t, dir, { ...botEnv(tg), ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);

  const notify = async (email, text) => (await (await fetch(base + '/api/notify', {
    method: 'POST', ...signedIn(email), body: JSON.stringify({ text }),
  })).json()).sent;
  assert.equal(await notify('sarah@example.test', 'sarah timer'), false);
  assert.equal(await notify('brent@example.test', 'brent timer'), true);
  assert.deepEqual(tg.sent.map((m) => m.text), ['⏱ <b>brent timer</b>']);
});

test('a photo sent to the bot is served to the admin only', { timeout: 15000 }, async (t) => {
  const photo = [{ file_id: 'photo1', file_unique_id: 'u1', width: 90, height: 90 }];
  const tg = await fakeTelegram(t, { updates: [{ update_id: 1, message: { chat: { id: OWNER }, date: 1, photo } }] });
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS });
  const { base, exitCode } = await boot(t, dir, { ...botEnv(tg), ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.length >= 1), 'the bridge did not confirm the photo');
  const [note] = await (await fetch(base + '/api/notes', signedIn('brent@example.test'))).json();
  const image = (email) => fetch(base + note.images[0], signedIn(email));
  const own = await image('brent@example.test');
  assert.equal(own.status, 200);
  assert.equal(await own.text(), 'photo bytes');
  assert.equal((await image('sarah@example.test')).status, 404);
});

// ---- phase 4: a chat is linked to a user with a pairing code ----
const SARAH_CHAT = 555;
const signedInAs = (email) => ({ headers: { 'x-auth-request-email': email } });
const readDb = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
let nextUpdate = 100;
const message = (chatId, text) => ({ update_id: nextUpdate++, message: { chat: { id: chatId }, date: 1, text } });

test('a chat linked with a pairing code posts to that user\'s board and gets that user\'s alerts', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS });
  const { base, exitCode } = await boot(t, dir, { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url, ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);
  assert.ok(await waitFor(async () => (await telegramStatus(base, signedInAs('sarah@example.test')))?.status === 'connected'), 'bridge never connected');

  const pair = await fetch(base + '/api/telegram/pair', { method: 'POST', ...signedInAs('sarah@example.test') });
  assert.equal(pair.status, 200);
  const { code, bot } = await pair.json();
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(bot, 'fake_bot');

  tg.push(message(SARAH_CHAT, `/start ${code}`));
  assert.ok(await waitFor(() => tg.sent.some((m) => m.chat_id === SARAH_CHAT && /linked/i.test(m.text))), 'no link confirmation');
  assert.deepEqual(readDb(dir).settings.tgUsers, { [SARAH_CHAT]: 'other-id' });

  tg.push(message(SARAH_CHAT, 'from sarah'));
  assert.ok(await waitFor(() => tg.sent.some((m) => m.chat_id === SARAH_CHAT && /added/i.test(m.text))), 'message not confirmed');
  const notes = async (email) => (await (await fetch(base + '/api/notes', signedInAs(email))).json()).map((n) => n.text);
  assert.deepEqual(await notes('sarah@example.test'), ['from sarah']);
  assert.deepEqual(await notes('brent@example.test'), []);

  // alerts follow the row owner: Sarah's timer reaches her chat, the admin's has no chat and goes nowhere
  const notify = async (email, text) => (await (await fetch(base + '/api/notify', {
    method: 'POST', headers: { ...signedInAs(email).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  })).json()).sent;
  assert.equal(await notify('sarah@example.test', 'sarah timer'), true);
  assert.equal(await notify('brent@example.test', 'brent timer'), false);
  assert.deepEqual(tg.sent.filter((m) => /timer/.test(m.text)).map((m) => [String(m.chat_id), m.text]), [[String(SARAH_CHAT), '⏱ <b>sarah timer</b>']]);

  const status = await (await fetch(base + '/api/status', signedInAs('sarah@example.test'))).json();
  assert.deepEqual(status.telegram.chats, [String(SARAH_CHAT)]);
  assert.equal(status.telegram.bot, 'fake_bot');
});

test('unlinking a chat stops its messages and alerts', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t);
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS, settings: { tgUsers: { [SARAH_CHAT]: 'other-id' } } });
  const { base, exitCode } = await boot(t, dir, { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url, ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);
  assert.ok(await waitFor(async () => (await telegramStatus(base, signedInAs('sarah@example.test')))?.status === 'connected'), 'bridge never connected');

  assert.equal((await fetch(base + '/api/telegram/pair', { method: 'DELETE', ...signedInAs('sarah@example.test') })).status, 200);
  assert.deepEqual(readDb(dir).settings.tgUsers, {});

  tg.push(message(SARAH_CHAT, 'after unlink'));
  assert.ok(await waitFor(() => tg.sent.some((m) => m.chat_id === SARAH_CHAT && /private/i.test(m.text))), 'chat was not refused');
  assert.deepEqual(await (await fetch(base + '/api/notes', signedInAs('sarah@example.test'))).json(), []);
});

test('with sign-in on, an unknown chat is refused instead of taking the admin board', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t, { updates: [message(STRANGER, 'hello'), message(STRANGER, '/start ZZZZZZ')] });
  const dir = tmpDataDir(t);
  seedDb(dir, { users: USERS });
  const { base, exitCode } = await boot(t, dir, { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url, ...PROXY });
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.filter((m) => m.chat_id === STRANGER).length >= 2), 'stranger did not get two replies');
  const replies = tg.sent.filter((m) => m.chat_id === STRANGER).map((m) => m.text);
  assert.match(replies[0], /private/i);
  assert.match(replies[1], /code/i, 'a bad pairing code should say so');
  assert.deepEqual(await (await fetch(base + '/api/notes', signedInAs('brent@example.test'))).json(), []);
  const { settings } = readDb(dir);
  assert.equal(settings.telegramChats, undefined, 'the first-chat lock engaged with sign-in on');
  assert.deepEqual(settings.tgUsers || {}, {});
});

test('without sign-in the bot still locks to the first chat that messages it', { timeout: 15000 }, async (t) => {
  const tg = await fakeTelegram(t, { updates: [message(OWNER, 'first')] });
  const dir = tmpDataDir(t);
  const { base, exitCode } = await boot(t, dir, { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url });
  assert.ok(base, `server exited with ${exitCode}`);

  assert.ok(await waitFor(() => tg.sent.some((m) => /added/i.test(m.text))), 'message not confirmed');
  assert.deepEqual((await (await fetch(base + '/api/notes')).json()).map((n) => n.text), ['first']);
  assert.deepEqual(readDb(dir).settings.telegramChats, [OWNER]);
});
