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
  await installProject({ root, tools: ['claude', 'codex'], interactive: false, executable: 'openspec' });
  return root;
}

async function readTemplate(root, schema, file) {
  return readFile(path.join(root, 'openspec', 'schemas', schema, 'templates', file), 'utf8');
}

function assertStructuredHandoff(comate) {
  for (const field of [
    '当前任务', '已确认事实与关键决策', '设计基线符合性', '项目规则符合性',
    '注释审计', '已检查文件/符号', '已补注释的符号与说明', '参数与生命周期说明', '豁免项及原因',
    '已修改文件', '已完成', '人工验证清单', '人工验证反馈', '验证证据',
    '生命周期结论', '安全与敏感信息结论', '下一步准确操作', '遗留风险与恢复条件',
  ]) assert.match(comate, new RegExp(field));
}

test('父模板把模式放在 comate，tasks 只保留实际任务', async () => {
  const root = await installIntoTemporaryProject();
  const tasks = await readTemplate(root, 'falla-spec-driven', 'tasks.md');
  const comate = await readTemplate(root, 'falla-spec-driven', 'comate.md');
  assert.doesNotMatch(tasks, /## 执行模式|## 验证模式|^- 模式：/m);
  assert.match(tasks, /允许编辑/);
  assert.match(tasks, /集成验证（有构建影响时保留独立任务/);
  assert.match(tasks, /一次只推进一个 ready task/);
  assert.match(tasks, /完成并验证后立即勾选/);
  assert.match(tasks, /\[人工\]/);
  assert.match(comate, /format-version\): 2/);
  assert.match(comate, /execution-mode\): single/);
  assert.match(comate, /validation-mode\): hybrid/);
  assert.match(comate, /human-review\): pending/);
  assert.match(comate, /depends-on/);
  assert.doesNotMatch(comate, /\(blocks\)/);
  assertStructuredHandoff(comate);
});

test('子模板不复制父模式、父任务或反向依赖', async () => {
  const root = await installIntoTemporaryProject();
  const tasks = await readTemplate(root, 'falla-task-driven', 'tasks.md');
  const comate = await readTemplate(root, 'falla-task-driven', 'comate.md');
  assert.doesNotMatch(tasks, /## 验证模式|^- 模式：/m);
  assert.match(tasks, /不得复制父任务清单或其他子 change/);
  assert.match(tasks, /父 design/);
  assert.match(tasks, /集成验证（有构建影响时保留独立任务/);
  assert.match(tasks, /一次只推进一个 ready task/);
  assert.match(tasks, /未完成时不得提前或批量补勾/);
  assert.match(tasks, /\[人工\]/);
  assert.match(comate, /format-version\): 2/);
  assert.doesNotMatch(comate, /execution-mode|\(blocks\)/);
  assert.match(comate, /validation-mode\): hybrid/);
  assert.match(comate, /depends-on/);
  assertStructuredHandoff(comate);
});
