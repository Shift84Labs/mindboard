const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

function tmpDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindboard_'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Boot server.js against dataDir. Resolves { notes } once the API answers,
// or { exitCode } if the process dies first.
async function boot(dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), TELEGRAM_BOT_TOKEN: '' },
    stdio: 'ignore',
  });
  let done = false;
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ exitCode: code })));
  const answered = (async () => {
    while (!done) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/notes`);
        return { notes: await res.json() };
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  })();
  const result = await Promise.race([exited, answered]);
  done = true;
  child.kill();
  return result;
}

test('first run without db.json starts with an empty board', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  assert.deepEqual(await boot(dir), { notes: [] });
});

test('corrupt db.json stops the server instead of serving an empty board', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  const corrupt = '{"notes":[{"id":"a1","title":"keep me"}'; // truncated JSON
  fs.writeFileSync(path.join(dir, 'db.json'), corrupt);

  const result = await boot(dir);

  assert.equal(result.notes, undefined, 'served a board from an unreadable db.json; the next save would overwrite it');
  assert.notEqual(result.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), corrupt);
});
