const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

test('first run without db.json starts with an empty board', { timeout: 10000 }, async (t) => {
  const { base, exitCode } = await boot(t, tmpDataDir(t));
  assert.ok(base, `server exited with ${exitCode}`);

  assert.deepEqual(await (await fetch(base + '/api/notes')).json(), []);
});

test('corrupt db.json stops the server instead of serving an empty board', { timeout: 10000 }, async (t) => {
  const dir = tmpDataDir(t);
  const corrupt = '{"notes":[{"id":"a1","title":"keep me"}'; // truncated JSON
  fs.writeFileSync(path.join(dir, 'db.json'), corrupt);

  const result = await boot(t, dir);

  assert.equal(result.base, undefined, 'served a board from an unreadable db.json; the next save would overwrite it');
  assert.notEqual(result.exitCode, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), corrupt);
});
