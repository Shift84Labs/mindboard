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

// Boot server.js against dataDir. Resolves { base } once the API answers, or
// { exitCode } if the process dies first. The process is killed when the test ends.
async function boot(t, dataDir) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), TELEGRAM_BOT_TOKEN: '' },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  let done = false;
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ exitCode: code })));
  const answered = (async () => {
    while (!done) {
      try {
        await fetch(base + '/api/notes');
        return { base };
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  })();
  const result = await Promise.race([exited, answered]);
  done = true;
  return result;
}

module.exports = { tmpDataDir, boot };
