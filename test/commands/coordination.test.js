import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { coordinationCommand } from '../../src/commands/coordination.js';

const execFileAsync = promisify(execFile);

function memoryIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    cwd,
    env: { PATH: process.env.PATH },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    output: () => ({ stdout, stderr }),
  };
}

async function createProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-command-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await cp(
    path.resolve('templates/openspec/schemas/falla-task-driven'),
    path.join(root, 'openspec', 'schemas', 'falla-task-driven'),
    { recursive: true }
  );
  await execFileAsync('openspec', ['new', 'change', 'medal', '--json'], { cwd: root });
  return root;
}

test('协调命令串联 register、官方 change、validate 和 resolve', async () => {
  const root = await createProject();
  const registerIo = memoryIo(root);
  await coordinationCommand(['register', 'medal/list-card', '--json'], registerIo);
  const registered = JSON.parse(registerIo.output().stdout);
  assert.equal(registered.physical, 'medal-child-list-card');

  await execFileAsync('openspec', [
    'new', 'change', registered.physical, '--schema', 'falla-task-driven', '--json',
  ], { cwd: root });
  const changeDir = path.join(root, 'openspec', 'changes', registered.physical);
  await writeFile(path.join(changeDir, 'tasks.md'), '- [ ] 1.1 implement\n', 'utf8');
  await writeFile(path.join(changeDir, 'comate.md'), `# comate

- 负责人 (owner): unassigned
- 状态 (status): todo
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff):
`, 'utf8');

  const validateIo = memoryIo(root);
  const validation = await coordinationCommand([
    'validate', '--change', 'medal', '--json',
  ], validateIo);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.ready, ['medal/list-card']);

  const resolveIo = memoryIo(root);
  await coordinationCommand(['resolve', 'medal/list-card', '--json'], resolveIo);
  const resolved = JSON.parse(resolveIo.output().stdout);
  assert.equal(resolved.lifecycle, 'active');
  assert.equal(resolved.physical, registered.physical);
});

test('协调命令拒绝未知参数和缺失 change', async () => {
  const root = await createProject();
  await assert.rejects(
    () => coordinationCommand(['resolve', 'medal/list-card', '--force'], memoryIo(root)),
    (error) => error.code === 1 && error.message.includes('未知参数')
  );
  await assert.rejects(
    () => coordinationCommand(['validate', '--json'], memoryIo(root)),
    (error) => error.code === 1 && error.message.includes('--change')
  );
});

test('协调命令可清理尚未创建物理 change 的孤儿映射', async () => {
  const root = await createProject();
  await coordinationCommand(['register', 'medal/orphan', '--json'], memoryIo(root));
  const unregisterIo = memoryIo(root);

  const result = await coordinationCommand([
    'unregister', 'medal/orphan', '--json',
  ], unregisterIo);

  assert.equal(result.removed, true);
  assert.equal(JSON.parse(unregisterIo.output().stdout).logical, 'medal/orphan');
  await assert.rejects(
    () => coordinationCommand(['resolve', 'medal/orphan', '--json'], memoryIo(root)),
    (error) => error.code === 1 && error.message.includes('找不到逻辑 change 映射')
  );
});

test('comate 已 done 但官方 artifacts 未完成时校验失败', async () => {
  const root = await createProject();
  const registerIo = memoryIo(root);
  await coordinationCommand(['register', 'medal/incomplete', '--json'], registerIo);
  const { physical } = JSON.parse(registerIo.output().stdout);

  await execFileAsync('openspec', ['new', 'change', physical, '--json'], { cwd: root });
  const changeDir = path.join(root, 'openspec', 'changes', physical);
  await writeFile(path.join(changeDir, 'tasks.md'), '- [x] 1.1 implemented\n', 'utf8');
  await writeFile(path.join(changeDir, 'comate.md'), `# comate

- 负责人 (owner): tester
- 状态 (status): done
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff): verified
`, 'utf8');

  const validation = await coordinationCommand([
    'validate', '--change', 'medal', '--json',
  ], memoryIo(root));
  assert.equal(validation.ok, false);
  assert.equal(
    validation.errors.some(({ kind }) => kind === 'artifacts-incomplete'),
    true
  );
});

test('父 DAG 同时包含 archived 和 active 子 change 时仍可校验', async () => {
  const root = await createProject();
  const archivedRegisterIo = memoryIo(root);
  await coordinationCommand(['register', 'medal/completed', '--json'], archivedRegisterIo);
  const archived = JSON.parse(archivedRegisterIo.output().stdout);
  await execFileAsync('openspec', [
    'new', 'change', archived.physical, '--schema', 'falla-task-driven', '--json',
  ], { cwd: root });
  const archivedDir = path.join(root, 'openspec', 'changes', archived.physical);
  await writeFile(path.join(archivedDir, 'tasks.md'), '- [x] 1.1 implemented\n', 'utf8');
  await writeFile(path.join(archivedDir, 'comate.md'), `# comate

- 负责人 (owner): tester
- 状态 (status): done
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff): verified
`, 'utf8');
  await execFileAsync('openspec', ['archive', archived.physical, '--yes', '--json'], { cwd: root });

  const activeRegisterIo = memoryIo(root);
  await coordinationCommand(['register', 'medal/pending', '--json'], activeRegisterIo);
  const active = JSON.parse(activeRegisterIo.output().stdout);
  await execFileAsync('openspec', [
    'new', 'change', active.physical, '--schema', 'falla-task-driven', '--json',
  ], { cwd: root });
  const activeDir = path.join(root, 'openspec', 'changes', active.physical);
  await writeFile(path.join(activeDir, 'tasks.md'), '- [ ] 1.1 implement\n', 'utf8');
  await writeFile(path.join(activeDir, 'comate.md'), `# comate

- 负责人 (owner): unassigned
- 状态 (status): todo
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff):
`, 'utf8');

  const validation = await coordinationCommand([
    'validate', '--change', 'medal', '--json',
  ], memoryIo(root));

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.ready, ['medal/pending']);
});
