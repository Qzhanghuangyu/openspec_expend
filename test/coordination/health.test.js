import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateChangeRecords } from '../../src/coordination/health.js';
import { registerMapping } from '../../src/coordination/resolver.js';

async function createProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-health-'));
  await mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
  return root;
}

function officialStatus(changeName, schemaName, {
  planningComplete = true,
  comateStatus = planningComplete ? 'done' : 'waiting',
} = {}) {
  return {
    changeName,
    schemaName,
    changeRoot: `/untrusted/${changeName}`,
    isPlanningComplete: planningComplete,
    isComplete: planningComplete,
    artifacts: [{
      id: 'comate', outputPath: 'comate.md', status: comateStatus, requires: ['tasks'],
    }],
    artifactPaths: {
      comate: {
        outputPath: 'comate.md',
        resolvedOutputPath: `/untrusted/${changeName}/comate.md`,
        existingOutputPaths: [],
      },
    },
    applyRequires: ['comate'],
    nextSteps: [],
    actionContext: {},
  };
}

function comate({
  mode,
  owner = 'alice',
  status = 'todo',
  dependsOn = [],
  blocks = [],
  handoff = '',
} = {}) {
  return `# comate

${mode ? `- 执行模式 (execution-mode): ${mode}\n` : ''}- 负责人 (owner): ${owner}
- 状态 (status): ${status}
- 依赖 (depends-on): [${dependsOn.join(', ')}]
- 被依赖 (blocks): [${blocks.join(', ')}]
- 交接 (handoff):
${handoff}
`;
}

async function writeRecord(root, physical, record, tasks = '- [ ] 1.1 pending\n') {
  const directory = path.join(root, 'openspec', 'changes', physical);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'comate.md'), record, 'utf8');
  await writeFile(path.join(directory, 'tasks.md'), tasks, 'utf8');
}

test('规划尚未到 comate 且文件缺失时不误报', async () => {
  const root = await createProject();
  await mkdir(path.join(root, 'openspec', 'changes', 'planning'));

  const report = await validateChangeRecords(root, [
    officialStatus('planning', 'falla-spec-driven', { planningComplete: false }),
    officialStatus('foreign', 'spec-driven', { planningComplete: false }),
  ]);

  assert.deepEqual(report, { ok: true, errors: [] });
});

test('完成记录接受填充后的多行 handoff 并拒绝空标签模板', async () => {
  const root = await createProject();
  await writeRecord(root, 'complete', comate({
    mode: 'single',
    status: 'done',
    handoff: `  - 已完成：列表页接线
  - 验证证据：
    - 命令：npm test
    - 结果：通过`,
  }), '- [x] 1.1 done\n');
  await writeRecord(root, 'empty', comate({
    mode: 'single',
    status: 'done',
    handoff: `  - 已完成：
  - 验证证据：
    - 命令：
    - 结果：`,
  }), '- [x] 1.1 done\n');

  const report = await validateChangeRecords(root, [
    officialStatus('complete', 'falla-spec-driven'),
    officialStatus('empty', 'falla-spec-driven'),
  ]);

  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, [{ kind: 'done-handoff-required', change: 'empty' }]);
});

test('报告 single 父状态与官方规划、子映射的模式矛盾', async () => {
  const root = await createProject();
  await writeRecord(root, 'medal', comate({
    mode: 'single', owner: 'alice', status: 'done', handoff: '  - 已完成：父任务',
  }), '- [x] 1.1 done\n');
  const mapping = await registerMapping(root, 'medal/card');
  await writeRecord(root, mapping.physical, comate({
    status: 'done', handoff: '  - 已完成：子任务',
  }), '- [x] 1.1 done\n');

  const report = await validateChangeRecords(root, [
    officialStatus('medal', 'falla-spec-driven', { planningComplete: false, comateStatus: 'done' }),
    officialStatus(mapping.physical, 'falla-task-driven'),
  ]);

  assert.deepEqual(
    report.errors.map(({ kind, change }) => ({ kind, change })),
    [
      { kind: 'artifacts-incomplete', change: 'medal' },
      { kind: 'execution-mode-conflict', change: 'medal' },
    ]
  );
});

test('父记录 done 时所有 parallel 子记录也必须 done', async () => {
  const root = await createProject();
  await writeRecord(root, 'medal', comate({
    mode: 'parallel', status: 'done', handoff: '  - 已完成：父任务',
  }), '- [x] 1.1 done\n');
  const mapping = await registerMapping(root, 'medal/card');
  await writeRecord(root, mapping.physical, comate({ owner: 'unassigned', status: 'todo' }));

  const report = await validateChangeRecords(root, [
    officialStatus('medal', 'falla-spec-driven'),
    officialStatus(mapping.physical, 'falla-task-driven'),
  ]);

  assert.equal(report.ok, false);
  assert.deepEqual(report.errors.filter(({ kind }) => kind === 'child-not-done'), [{
    kind: 'child-not-done', change: 'medal', related: 'medal/card',
  }]);
  assert.doesNotMatch(JSON.stringify(report), /alice|handoff|\/untrusted/);
});

test('健康校验拒绝读取符号链接记录', async () => {
  const root = await createProject();
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'falla-health-outside-')), 'comate.md');
  await writeFile(outside, comate({ mode: 'single' }), 'utf8');
  const directory = path.join(root, 'openspec', 'changes', 'linked');
  await mkdir(directory);
  await symlink(outside, path.join(directory, 'comate.md'));

  await assert.rejects(
    () => validateChangeRecords(root, [officialStatus('linked', 'falla-spec-driven')]),
    (error) => error.code === 1 && error.message.includes('符号链接')
  );
});
