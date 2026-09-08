import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { snapshotTree } from '../helpers/snapshot.js';

const execFileAsync = promisify(execFile);
const cli = path.resolve('bin/falla-openspec.js');
const androidRoot = process.env.FALLA_ANDROID_CANARY_ROOT;

test('Android 项目 canary 只读 dry-run 不改变 mercuryspec、openspec 或 .falla', {
  skip: androidRoot ? false : '未设置 FALLA_ANDROID_CANARY_ROOT',
}, async () => {
  const before = {
    legacy: await snapshotTree(path.join(androidRoot, 'mercuryspec')),
    openSpec: await snapshotTree(path.join(androidRoot, 'openspec')),
    falla: await snapshotTree(path.join(androidRoot, '.falla')),
  };
  const result = await execFileAsync(process.execPath, [cli, 'migrate', androidRoot, '--json'], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
  });
  const report = JSON.parse(result.stdout);

  assert.equal(report.dryRun, true);
  assert.ok(report.counts.copy > 0);
  assert.ok(Object.keys(report.mappings).length > 0);
  assert.deepEqual(await snapshotTree(path.join(androidRoot, 'mercuryspec')), before.legacy);
  assert.deepEqual(await snapshotTree(path.join(androidRoot, 'openspec')), before.openSpec);
  assert.deepEqual(await snapshotTree(path.join(androidRoot, '.falla')), before.falla);
});
