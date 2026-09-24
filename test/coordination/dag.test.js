import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateCoordination } from '../../src/coordination/dag.js';
import { registerMapping } from '../../src/coordination/resolver.js';

async function createGraph(nodes) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-coordination-dag-'));
  const changes = path.join(root, 'openspec', 'changes');
  await mkdir(path.join(changes, 'medal'), { recursive: true });

  for (const node of nodes) {
    const mapping = await registerMapping(root, `medal/${node.name}`);
    const directory = path.join(changes, mapping.physical);
    await mkdir(directory);
    await writeFile(path.join(directory, 'comate.md'), `# comate

- 负责人 (owner): ${node.owner ?? 'alice'}
- 状态 (status): ${node.status}
- 依赖 (depends-on): [${node.dependsOn.join(', ')}]
- 被依赖 (blocks): [${node.blocks.join(', ')}]
- 交接 (handoff): ${node.handoff ?? '已完成验证'}
`, 'utf8');
    await writeFile(
      path.join(directory, 'tasks.md'),
      node.pending ? '- [ ] 1.1 pending\n' : '- [x] 1.1 done\n',
      'utf8'
    );
  }
  return root;
}

test('单向依赖可推导反向关系并返回可开始节点', async () => {
  const root = await createGraph([
    {
      name: 'view-model', status: 'done', dependsOn: [], blocks: ['medal/list-card'],
    },
    {
      name: 'list-card', status: 'todo', dependsOn: ['medal/view-model'], blocks: [],
    },
  ]);

  const report = await validateCoordination(root, { change: 'medal' });
  assert.equal(report.ok, true);
  assert.deepEqual(report.ready, ['medal/list-card']);
  assert.deepEqual(report.errors, []);
});

test('忽略旧 blocks 字段并发现不存在的依赖节点', async () => {
  const root = await createGraph([
    {
      name: 'list-card', status: 'todo', dependsOn: ['medal/missing'], blocks: [],
    },
  ]);

  const report = await validateCoordination(root, { change: 'medal' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors.map(({ kind }) => kind), ['missing-dependency']);
});

test('发现依赖环和上游未完成时提前实施', async () => {
  const root = await createGraph([
    {
      name: 'view-model', status: 'in-progress', dependsOn: ['medal/list-card'],
      blocks: ['medal/list-card'],
    },
    {
      name: 'list-card', status: 'in-progress', dependsOn: ['medal/view-model'],
      blocks: ['medal/view-model'],
    },
  ]);

  const report = await validateCoordination(root, { change: 'medal' });
  const kinds = report.errors.map(({ kind }) => kind);
  assert.equal(kinds.includes('cycle'), true);
  assert.equal(kinds.filter((kind) => kind === 'dependency-not-done').length, 2);
});

test('done 状态拒绝未完成任务且报告不泄露 owner 或 handoff', async () => {
  const root = await createGraph([
    {
      name: 'list-card', status: 'done', dependsOn: [], blocks: [], pending: true,
      owner: 'SECRET_OWNER', handoff: 'SENSITIVE_HANDOFF_BODY',
    },
  ]);

  const report = await validateCoordination(root, { change: 'medal' });
  assert.equal(report.errors.some(({ kind }) => kind === 'tasks-incomplete'), true);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_OWNER|SENSITIVE_HANDOFF_BODY/);
});

test('上游回退为 in-progress 后，下游 blocked 可保持依赖校验通过', async () => {
  const root = await createGraph([
    {
      name: 'view-model', status: 'in-progress', dependsOn: [], blocks: [], pending: true,
    },
    {
      name: 'list-card', status: 'blocked', dependsOn: ['medal/view-model'], blocks: [],
      handoff: '等待上游恢复并复验',
    },
  ]);

  const report = await validateCoordination(root, { change: 'medal' });
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.blocked, ['medal/list-card']);
});

test('DAG 校验拒绝通过 comate 符号链接读取项目外内容', async () => {
  const root = await createGraph([
    { name: 'list-card', status: 'todo', dependsOn: [], blocks: [] },
  ]);
  const mapping = await registerMapping(root, 'medal/list-card');
  const comatePath = path.join(root, 'openspec', 'changes', mapping.physical, 'comate.md');
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'falla-dag-outside-')), 'comate.md');
  await writeFile(outside, `# comate

- 负责人 (owner): outside
- 状态 (status): todo
- 依赖 (depends-on): []
- 被依赖 (blocks): []
- 交接 (handoff):
`, 'utf8');
  await unlink(comatePath);
  await symlink(outside, comatePath);

  const report = await validateCoordination(root, { change: 'medal' });
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors.map(({ kind }) => kind), ['invalid-node']);
});
