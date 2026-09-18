import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyManagedFileRemovalPlan,
  applyManagedFilePlan,
  planManagedFileRemovals,
  planManagedFiles,
  sha256,
} from '../../src/install/files.js';
import {
  applyHookRegistrationPlan,
  planHookRegistrations,
} from '../../src/install/hooks.js';

async function createRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'falla-write-race-'));
}

test('受管文件更新计划生成后发生用户修改时拒绝覆盖并保留修改', async () => {
  const root = await createRoot();
  const relativePath = '.falla/example.md';
  const target = path.join(root, '.falla', 'example.md');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'installed version\n');
  const plan = await planManagedFiles(root, [{
    relativePath,
    content: Buffer.from('updated version\n'),
  }], {
    [relativePath]: sha256('installed version\n'),
  });

  await writeFile(target, 'user edit after planning\n');

  await assert.rejects(
    () => applyManagedFilePlan(root, plan),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(target, 'utf8'), 'user edit after planning\n');
});

test('受管文件新建计划生成后目标被并发创建时拒绝覆盖并保留新文件', async () => {
  const root = await createRoot();
  const relativePath = '.falla/new.md';
  const target = path.join(root, '.falla', 'new.md');
  const plan = await planManagedFiles(root, [{
    relativePath,
    content: Buffer.from('managed content\n'),
  }]);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'concurrent user file\n');

  await assert.rejects(
    () => applyManagedFilePlan(root, plan),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(target, 'utf8'), 'concurrent user file\n');
});

test('删除计划中后续文件发生冲突时预检整批且不先删除其他文件', async () => {
  const root = await createRoot();
  const firstPath = '.falla/first.md';
  const secondPath = '.falla/second.md';
  const firstTarget = path.join(root, '.falla', 'first.md');
  const secondTarget = path.join(root, '.falla', 'second.md');
  await mkdir(path.dirname(firstTarget), { recursive: true });
  await writeFile(firstTarget, 'first installed\n');
  await writeFile(secondTarget, 'second installed\n');
  const plan = await planManagedFileRemovals(root, [firstPath, secondPath], {
    [firstPath]: sha256('first installed\n'),
    [secondPath]: sha256('second installed\n'),
  });

  await writeFile(secondTarget, 'second user edit\n');

  await assert.rejects(
    () => applyManagedFileRemovalPlan(root, plan),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(firstTarget, 'utf8'), 'first installed\n');
  assert.equal(await readFile(secondTarget, 'utf8'), 'second user edit\n');
});

test('Hook 计划生成后 marker 外内容变化时整批拒绝且不产生部分写入', async () => {
  const root = await createRoot();
  const agentsPath = path.join(root, 'AGENTS.md');
  await writeFile(agentsPath, '用户规则 v1\n');
  const plan = await planHookRegistrations(root, ['codex']);

  await writeFile(agentsPath, '用户规则 v2\n');

  await assert.rejects(
    () => applyHookRegistrationPlan(root, plan),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(agentsPath, 'utf8'), '用户规则 v2\n');
  await assert.rejects(
    () => readFile(path.join(root, '.codex', 'config.toml')),
    (error) => error.code === 'ENOENT'
  );
});

test('Claude Hook 计划生成后用户 JSON 字段变化时拒绝覆盖并保留字段', async () => {
  const root = await createRoot();
  const settingsPath = path.join(root, '.claude', 'settings.json');
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, '{\n  "theme": "light"\n}\n');
  const plan = await planHookRegistrations(root, ['claude']);
  const changed = '{\n  "theme": "dark",\n  "language": "zh-CN"\n}\n';

  await writeFile(settingsPath, changed);

  await assert.rejects(
    () => applyHookRegistrationPlan(root, plan),
    (error) => error.code === 1 && error.message.includes('用户修改')
  );
  assert.equal(await readFile(settingsPath, 'utf8'), changed);
});
