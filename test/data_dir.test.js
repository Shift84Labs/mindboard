const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

// root ignores file permissions, so these only mean something as a normal user
const skip = process.getuid() === 0 && 'running as root';

for (const [label, sub] of [['data dir', ''], ['uploads dir', 'uploads']]) {
  test(`read-only ${label} stops the server instead of failing every save`, { skip, timeout: 10000 }, async (t) => {
    const dir = tmpDataDir(t);
    fs.mkdirSync(path.join(dir, 'uploads'));
    const readOnly = path.join(dir, sub);
    fs.chmodSync(readOnly, 0o555);

    const result = await boot(t, dir);
    fs.chmodSync(readOnly, 0o755); // so tmpDataDir can clean up

    assert.equal(result.base, undefined, `server started with a read-only ${label}; every save would fail`);
    assert.notEqual(result.exitCode, 0);
  });
}
