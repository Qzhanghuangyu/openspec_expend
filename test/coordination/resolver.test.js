import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { registerMapping, resolveChange } from '../../src/coordination/resolver.js';

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-resolve-'));
  await mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
  return root;
}

test('注册映射保持幂等并要求父 change 存在', async () => {
  const root = await project();
  await assert.rejects(
    () => registerMapping(root, 'medal/detail'),
    (error) => error.code === 1 && error.message.includes('父 change')
  );

  await mkdir(path.join(root, 'openspec', 'changes', 'medal'));
  const first = await registerMapping(root, 'medal/detail');
  const second = await registerMapping(root, 'medal/detail');

  assert.deepEqual(first, {
    logical: 'medal/detail',
    physical: 'medal-child-detail',
    parent: 'medal',
    created: true,
  });
  assert.equal(second.created, false);
  assert.equal(second.physical, first.physical);
});

test('解析 active 逻辑子 change 和顶层 change', async () => {
  const root = await project();
  await mkdir(path.join(root, 'openspec', 'changes', 'medal'));
  await registerMapping(root, 'medal/detail');
  await mkdir(path.join(root, 'openspec', 'changes', 'medal-child-detail'));

  assert.deepEqual(await resolveChange(root, 'medal/detail'), {
    logical: 'medal/detail',
    physical: 'medal-child-detail',
    parent: 'medal',
    path: path.join(root, 'openspec', 'changes', 'medal-child-detail'),
    lifecycle: 'active',
  });
  assert.equal((await resolveChange(root, 'medal')).physical, 'medal');
});

test('active 缺失时从标准 archive 定位且拒绝多个候选', async () => {
  const root = await project();
  await mkdir(path.join(root, 'openspec', 'changes', 'medal'));
  await registerMapping(root, 'medal/detail');
  const archive = path.join(root, 'openspec', 'changes', 'archive');
  await mkdir(path.join(archive, '2026-09-08-medal-child-detail'), { recursive: true });

  assert.equal((await resolveChange(root, 'medal/detail')).lifecycle, 'archived');
  await mkdir(path.join(archive, '2026-09-09-medal-child-detail'));
  await assert.rejects(
    () => resolveChange(root, 'medal/detail'),
    (error) => error.code === 1 && error.message.includes('多个归档')
  );
});
