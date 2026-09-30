import { writeTestBaseline } from '../helpers/baseline.js';
import { writeReviewedPreflight } from '../helpers/preflight.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimChange } from '../../src/coordination/claim.js';
import { validateCoordination } from '../../src/coordination/dag.js';
import { validateChangeRecords } from '../../src/coordination/health.js';
import { registerMapping } from '../../src/coordination/resolver.js';
import { validateTaskDependencies } from '../../src/coordination/tasks.js';

async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-task-gates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = new Map();
  const statuses = new Map();
  async function create(reference, { tasks = '- [ ] 1.1 A', mode = 'single', status = 'todo', dependsOn = [] } = {}) {
    const child = reference.includes('/');
    const physical = child ? (await registerMapping(root, reference)).physical : reference;
    const directory = path.join(root, 'openspec/changes', physical);
    await mkdir(directory, { recursive: true });
    const record = `# comate
${child ? '' : `- 执行模式 (execution-mode): ${mode}\n`}- 负责人 (owner): ${status === 'todo' ? 'unassigned' : 'alice'}
- 状态 (status): ${status}
- 依赖 (depends-on): [${dependsOn.join(', ')}]
- 交接 (handoff): 已检查
`;
    await writeReviewedPreflight(directory);
    await writeFile(path.join(directory, 'comate.md'), record);
    await writeFile(path.join(directory, 'tasks.md'), tasks);
    // 无效图仍必须先被门禁拒绝；不要给重复编号夹具生成伪造快照。
    if (validateTaskDependencies(tasks).length === 0) await writeTestBaseline(root, reference);
    records.set(reference, path.join(directory, 'comate.md'));
    statuses.set(physical, {
      changeName: physical, schemaName: child ? 'falla-task-driven' : 'falla-spec-driven',
      isPlanningComplete: true, artifacts: [{ id: 'comate', status: 'done' }],
    });
  }
  return {
    create,
    validate: change => validateCoordination(root, { change, statusProvider: async id => statuses.get(id) }),
    health: () => validateChangeRecords(root, [...statuses.values()]),
    claim: reference => claimChange(root, reference, { owner: 'alice', statusProvider: async id => statuses.get(id) }),
    record: reference => readFile(records.get(reference), 'utf8'),
  };
}

test('任务编号或依赖错误在父、子记录中阻断校验和首次/幂等认领，失败不落盘', async t => {
  for (const target of ['page', 'page/view']) {
    for (const status of ['todo', 'in-progress']) {
      const p = await project(t);
      if (target.includes('/')) await p.create('page', { mode: 'parallel', status: 'in-progress' });
      await p.create(target, { status, tasks: '- [ ] 1.1 SECRET_BODY（依赖：9.9）\n- [ ] 1.1 A' });
      for (const report of [await p.validate('page'), await p.health()]) {
        assert.equal(report.ok, false);
        for (const kind of ['task-id-duplicate', 'task-dependency-missing']) {
          assert.ok(report.errors.some(error => error.kind === kind && error.change === target), kind);
        }
        assert.doesNotMatch(JSON.stringify(report), /SECRET_BODY/);
      }
      const before = await p.record(target);
      await assert.rejects(() => p.claim(target), /验证/);
      assert.equal(await p.record(target), before);
    }
  }
});

test('跨 change 的已完成依赖仍检查本地任务图，兄弟任务错误也阻止认领', async t => {
  const p = await project(t);
  await p.create('foundation', { status: 'done', tasks: '- [x] 1.1 A（依赖：9.9）' });
  await p.create('page', { mode: 'parallel', status: 'in-progress' });
  await p.create('page/view', { dependsOn: ['foundation'] });
  assert.ok((await p.validate('page')).errors.some(error =>
    error.kind === 'task-dependency-missing' && error.change === 'foundation'));
  const before = await p.record('page/view');
  await assert.rejects(() => p.claim('page/view'), /依赖验证/);
  assert.equal(await p.record('page/view'), before);

  await p.create('foundation', { status: 'done', tasks: '- [x] 1.1 A' });
  await p.create('page/sibling', { tasks: '- [ ] 1.1 A（依赖：1.1）' });
  await assert.rejects(() => p.claim('page/view'), /协作验证/);
  assert.equal(await p.record('page/view'), before);
});

test('任务检查点拒绝先于前置的完成标记，撤销失效勾选后可恢复', async t => {
  const p = await project(t);
  await p.create('page', { status: 'in-progress', tasks: '- [ ] 1.1 契约\n- [x] 2.1 实施（依赖：1.1）' });
  for (const report of [await p.validate('page'), await p.health()]) {
    assert.ok(report.errors.some(error => error.kind === 'task-dependency-not-done'));
  }
  const before = await p.record('page');
  await assert.rejects(() => p.claim('page'), /验证/);
  assert.equal(await p.record('page'), before);
  await p.create('page', { status: 'in-progress', tasks: '- [ ] 1.1 契约\n- [ ] 2.1 实施（依赖：1.1）' });
  assert.equal((await p.validate('page')).ok, true);
  assert.equal((await p.health()).ok, true);
  assert.equal((await p.claim('page')).idempotent, true);
});
