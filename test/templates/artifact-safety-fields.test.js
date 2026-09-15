import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { installProject } from '../../src/commands/install.js';

const execFileAsync = promisify(execFile);

async function installIntoTemporaryProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-template-contract-'));
  await execFileAsync('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await installProject({
    root,
    tools: ['claude', 'codex'],
    interactive: false,
    executable: 'openspec',
  });
  return root;
}

async function readInstalledTemplate(root, schema, file) {
  return readFile(
    path.join(root, 'openspec', 'schemas', schema, 'templates', file),
    'utf8'
  );
}

test('父 change 模板要求记录生命周期、安全和验证证据', async () => {
  const root = await installIntoTemporaryProject();
  const design = await readInstalledTemplate(root, 'falla-spec-driven', 'design.md');
  const tasks = await readInstalledTemplate(root, 'falla-spec-driven', 'tasks.md');
  const comate = await readInstalledTemplate(root, 'falla-spec-driven', 'comate.md');

  assert.match(design, /## 生命周期与状态恢复/);
  assert.match(design, /页面销毁后更新 UI/);
  assert.match(design, /## 安全与敏感信息/);
  assert.match(design, /日志与上报/);

  assert.match(tasks, /## 执行模式/);
  assert.match(tasks, /模式：single/);
  assert.match(tasks, /只有用户明确要求并行分派时才改为 parallel/);
  assert.match(tasks, /空值、异常、弱网和重复操作/);
  assert.match(tasks, /协程、Flow、观察者、回调和监听器/);
  assert.match(tasks, /验证命令、variant\/设备、结果/);

  assert.match(comate, /execution-mode\): single/);
  assert.match(comate, /验证证据/);
  assert.match(comate, /生命周期结论/);
  assert.match(comate, /安全与敏感信息结论/);
  assert.match(comate, /遗留风险与接手条件/);
});

test('子 change 模板要求完成同等级验证并结构化交接', async () => {
  const root = await installIntoTemporaryProject();
  const tasks = await readInstalledTemplate(root, 'falla-task-driven', 'tasks.md');
  const comate = await readInstalledTemplate(root, 'falla-task-driven', 'comate.md');

  assert.match(tasks, /空值、异常、弱网和重复操作/);
  assert.match(tasks, /协程、Flow、观察者、回调和监听器/);
  assert.match(tasks, /日志、缓存、网络请求和产物/);
  assert.match(tasks, /验证命令、variant\/设备、结果/);

  assert.match(comate, /验证证据/);
  assert.match(comate, /生命周期结论/);
  assert.match(comate, /安全与敏感信息结论/);
  assert.match(comate, /遗留风险与接手条件/);
});
