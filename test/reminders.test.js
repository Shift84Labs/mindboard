const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDataDir, boot } = require('./helpers');

const HOUR = 3600e3;

async function timedBoot(t, dir) {
  const started = Date.now();
  const { base, exitCode } = await boot(t, dir);
  assert.ok(base, `server exited with ${exitCode}`);
  return { base, ms: Date.now() - started };
}

test('a repeating reminder far in the past is advanced without stalling the server', { timeout: 30000 }, async (t) => {
  const baseline = await timedBoot(t, tmpDataDir(t));

  const dir = tmpDataDir(t);
  // the earliest date JavaScript can represent: stepping it forward an hour at a time takes billions of iterations
  const reminder = { id: 'dddddddddddddddd', text: 'ancient', at: '-271821-04-20T00:00:00.000Z', freq: 'hourly', enabled: true };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ notes: [], tags: [], widgets: [], settings: {}, reminders: [reminder] }));
  const { base, ms } = await timedBoot(t, dir);

  assert.ok(ms < baseline.ms + 1000, `startup took ${ms} ms, against ${baseline.ms} ms for an empty board`);
  const [rem] = await (await fetch(base + '/api/reminders')).json();
  const at = Date.parse(rem.at);
  const now = Date.now();
  assert.equal(at % HOUR, 0, `${rem.at} is not on a whole hour of the original schedule`);
  assert.ok(at > now - 60e3 && at <= now + HOUR, `${rem.at} is not the next occurrence after now`);
});
