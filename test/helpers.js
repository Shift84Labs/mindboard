const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

const servers = new WeakMap(); // test context -> server processes it booted

// Stop every server a test booted and wait until each one has exited.
function stopServers(t) {
  const running = [...(servers.get(t) || [])].filter((child) => child.exitCode === null && child.signalCode === null);
  return Promise.all(running.map((child) => new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  })));
}

function tmpDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindboard_'));
  // after hooks run in registration order and a throwing hook skips the rest, so the test's
  // servers are stopped here first: one still running could write into dir mid-delete, and
  // a failed delete must not leave it running and hang the test run
  t.after(async () => {
    await stopServers(t);
    fs.rmSync(dir, { recursive: true, force: true });
  });
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

// Boot server.js against dataDir, with optional env overrides. Resolves { base } once the
// server is listening, or { exitCode } if the process dies first. The process is killed when the test ends.
// The server picks its own port (PORT=0) and reports it: a port found free here could be taken by
// a test file running in parallel before the server binds it, and the test would talk to that server.
async function boot(t, dataDir, env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: '0', TELEGRAM_BOT_TOKEN: '', ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  servers.set(t, (servers.get(t) || new Set()).add(child));
  t.after(() => stopServers(t));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ exitCode: code })));
  const listening = new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      const port = (out += chunk).match(/running at http:\/\/localhost:(\d+)/)?.[1];
      if (port) resolve({ base: `http://127.0.0.1:${port}` });
    });
  });
  return Promise.race([exited, listening]);
}

module.exports = { tmpDataDir, boot, freePort };
