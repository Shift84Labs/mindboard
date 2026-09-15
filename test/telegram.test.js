const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

const OWNER = 111;
const STRANGER = 999;

// Minimal stand-in for the Bot API: hands out the queued updates once, records
// every sendMessage and answers each send with sendResult.
async function fakeTelegram(t, { updates = [], sendResult = { ok: true, result: {} } } = {}) {
  const sent = [];
  let pending = updates;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const method = req.url.split('/').pop();
      const reply = (body) => res.end(JSON.stringify(body));
      if (method === 'getMe') return reply({ ok: true, result: { username: 'fake_bot' } });
      if (method === 'getUpdates') {
        const result = pending;
        pending = [];
        return setTimeout(() => reply({ ok: true, result }), result.length ? 0 : 100);
      }
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
  return { url: `http://127.0.0.1:${server.address().port}`, sent };
}

function botEnv(tg) {
  return { TELEGRAM_BOT_TOKEN: 'test_token', TELEGRAM_API_URL: tg.url, TELEGRAM_ALLOWED_CHAT_ID: String(OWNER) };
}

function seedDb(dir, data) {
  const db = { notes: [], tags: [], widgets: [], settings: {}, reminders: [], ...data };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
}

async function waitFor(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (check()) return true;
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
