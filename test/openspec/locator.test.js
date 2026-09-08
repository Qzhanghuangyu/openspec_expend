import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findProjectRoot } from '../../src/openspec/locator.js';

test('从任意子目录定位最近的 openspec 项目根', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-root-'));
  const nested = path.join(root, 'feature', 'deep');
  await mkdir(path.join(root, 'openspec'), { recursive: true });
  await mkdir(nested, { recursive: true });

  assert.equal(await findProjectRoot(nested), root);
});

test('找不到 openspec 根时明确失败', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-openspec-root-'));

  await assert.rejects(
    () => findProjectRoot(root),
    (error) => error.code === 1 && error.message.includes('openspec')
  );
});
