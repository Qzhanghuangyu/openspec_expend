import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { coordinationCommand } from '../../src/commands/coordination.js';
import { doctorProject } from '../../src/commands/doctor.js';
import { validateChangeRecords } from '../../src/coordination/health.js';

const exec = promisify(execFile);

// 真正运行官方规划状态和公开协调命令，不用永远返回 ready 的 status stub。
async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'falla-transitions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const official = async (...args) => JSON.parse((await exec('openspec', [...args, '--json'], { cwd: root })).stdout);
  await exec('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await cp(path.resolve('templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  const files = new Map();
  const command = (...args) => coordinationCommand([...args, '--json'], {
    cwd: root, env: process.env, stdout: { write() {} }, stderr: { write() {} },
  });
  async function create(reference, options = {}) {
    const child = reference.includes('/');
    const physical = child ? (await command('register', reference)).physical : reference;
    await official('new', 'change', physical, '--schema', child ? 'falla-task-driven' : 'falla-spec-driven');
    const directory = path.join(root, 'openspec/changes', physical);
    files.set(reference, directory);
    if (!child) {
      await writeFile(path.join(directory, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
      for (const artifact of ['preflight', 'proposal', 'design']) {
        await writeFile(path.join(directory, `${artifact}.md`), `# ${artifact}\n内部重构，无规格变化。\n`);
      }
    }
    await set(reference, { mode: child ? null : 'single', ...options });
    const status = await official('status', '--change', physical);
    assert.equal(status.isPlanningComplete, true);
    return physical;
  }
  async function set(reference, {
    mode = reference.includes('/') ? null : 'parallel', status = 'todo',
    owner = status === 'todo' ? 'unassigned' : 'alice', dependencies = [],
    validation = 'hybrid', review = 'not-required', feedback = '',
    tasks = `- [${status === 'done' ? 'x' : ' '}] 1.1 实施\n`,
  } = {}) {
    const directory = files.get(reference);
    await writeFile(path.join(directory, 'tasks.md'), tasks);
    await writeFile(path.join(directory, 'comate.md'), `# comate
- 格式版本 (format-version): 2
${mode ? `- 执行模式 (execution-mode): ${mode}\n` : ''}- 负责人 (owner): ${owner}
- 状态 (status): ${status}
- 验证模式 (validation-mode): ${validation}
- 人工验证状态 (human-review): ${review}
- 依赖 (depends-on): [${dependencies.join(', ')}]
- 交接 (handoff):
  - 已完成：记录当前验证结果
  - 注释审计：变更符号已核对
  - 验证证据：定向验证已记录
  - 人工验证反馈：${feedback}
  - 安全与敏感信息结论：未输出敏感信息
  - 遗留风险与恢复条件：根据失败证据复验
`);
  }
  const validate = () => command('validate', '--change', 'page');
  const health = async () => validateChangeRecords(root, (await official('status', '--all')).changes);
  const claim = reference => command('claim', reference, '--owner', 'alice');
  const record = reference => readFile(path.join(files.get(reference), 'comate.md'), 'utf8');
  // 只核对 workflow 分组：这个最小夹具没有安装工具/Hook，不声称 installation 通过。
  const doctor = async () => (await doctorProject({ root })).groups.workflow;
  return { create, set, validate, health, claim, record, doctor };
}

const has = (result, kind) => result.errors.some(error => error.kind === kind);

test('官方规划 → 认领 → 协调与健康校验一致；跨父依赖不产生虚假 missing', async t => {
  const p = await project(t);
  await p.create('foundation', { status: 'done' });
  await p.create('page', { mode: 'parallel' });
  await p.create('page/view', { dependencies: ['foundation'] });
  assert.equal((await p.claim('page/view')).claimed, true);
  assert.equal((await p.validate()).ok, true);
  assert.equal((await p.health()).ok, true);
  assert.equal((await p.doctor()).ok, true);
  assert.equal((await p.claim('page/view')).idempotent, true);
  // done 字样不足以解锁：跨父依赖撤销 checkbox 后，幂等认领也必须重新验证。
  await p.set('foundation', { mode: 'single', status: 'done', tasks: '- [ ] 1.1 已失效\n' });
  const before = await p.record('page/view');
  assert.equal(has(await p.validate(), 'tasks-incomplete'), true);
  await assert.rejects(() => p.claim('page/view'), /依赖验证/);
  assert.equal(await p.record('page/view'), before);
});

test('认领前拒绝人工任务与 agent 模式冲突，失败不写 owner/status', async t => {
  const p = await project(t);
  await p.create('page');
  await p.set('page', { mode: 'single', validation: 'agent', tasks: '- [ ] 1.1 [人工] 验收\n' });
  const before = await p.record('page');
  assert.equal(has(await p.validate(), 'validation-mode-conflict'), true);
  await assert.rejects(() => p.claim('page'), /验证/);
  assert.equal(await p.record('page'), before);
  // 已认领后更改了任务时，同 owner 重试也不能绕过当前记录校验。
  await p.set('page', { mode: 'single', status: 'in-progress', validation: 'agent', tasks: '- [ ] 1.1 [人工] 验收\n' });
  const claimed = await p.record('page');
  await assert.rejects(() => p.claim('page'), /验证/);
  assert.equal(await p.record('page'), claimed);
});

test('跨父依赖环不能通过校验或解锁认领，物理名别名也不能绕过', async t => {
  const p = await project(t);
  await p.create('page', { mode: 'parallel', status: 'done' });
  const physical = await p.create('page/view', { status: 'done', dependencies: ['foundation'] });
  await p.create('foundation', { status: 'done', dependencies: ['page/view'] });
  await p.create('consumer', { dependencies: ['foundation'] });
  for (const reference of ['page/view', physical]) {
    await p.set('foundation', { mode: 'single', status: 'done', dependencies: [reference] });
    assert.equal(has(await p.validate(), 'cycle'), true, reference);
    const before = await p.record('consumer');
    await assert.rejects(() => p.claim('consumer'), /验证/);
    assert.equal(await p.record('consumer'), before);
  }
  // 父完成还隐含依赖所有子完成，不能只对显式 depends-on 查环。
  await p.set('foundation', { mode: 'parallel', status: 'done' });
  await p.create('foundation/core', { status: 'done', dependencies: [physical] });
  assert.equal(has(await p.validate(), 'cycle'), true);
  await assert.rejects(() => p.claim('consumer'), /验证/);
  await p.set('foundation/core', { status: 'done' });
  assert.equal((await p.validate()).ok, true);
  assert.equal((await p.claim('consumer')).claimed, true);
});

test('外部父依赖和当前兄弟节点都受完成门禁约束，认领失败不落盘', async t => {
  const p = await project(t);
  await p.create('foundation', { mode: 'parallel', status: 'done' });
  await p.create('foundation/core');
  await p.create('page', { mode: 'parallel' });
  await p.create('page/view', { dependencies: ['foundation'] });
  assert.equal(has(await p.validate(), 'child-not-done'), true);
  const before = await p.record('page/view');
  await assert.rejects(() => p.claim('page/view'), /验证/);
  assert.equal(await p.record('page/view'), before);
  await p.set('foundation/core', { status: 'done' });
  assert.equal((await p.claim('page/view')).claimed, true);
  assert.equal((await p.validate()).ok, true);

  await p.create('page/independent', { status: 'done', tasks: '- [ ] 1.1 失效的完成记录\n' });
  await p.create('page/next');
  for (const reference of ['page/view', 'page/next']) {
    const record = await p.record(reference);
    await assert.rejects(() => p.claim(reference), /验证/);
    assert.equal(await p.record(reference), record);
  }
});

test('父子完成 → 错误回退被拒绝 → 暂停下游并恢复父状态 → 依赖顺序复验', async t => {
  const p = await project(t);
  await p.create('page', { mode: 'parallel', status: 'done' });
  await p.create('page/model', { status: 'done' });
  await p.create('page/view', { status: 'done', dependencies: ['page/model'] });
  assert.equal((await p.validate()).ok, true);
  await p.set('page/model', { status: 'in-progress' });
  let report = await p.validate();
  assert.equal(has(report, 'child-not-done'), true);
  assert.equal(has(report, 'dependency-not-done'), true);
  assert.equal(has(await p.health(), 'child-not-done'), true);
  await p.set('page/view', { status: 'blocked', dependencies: ['page/model'] });
  await p.set('page', { status: 'in-progress' });
  assert.equal((await p.validate()).ok, true);
  await assert.rejects(() => p.claim('page/view'), /blocked/);
  await p.set('page/model', { status: 'done' });
  await p.set('page/view', { status: 'in-progress', dependencies: ['page/model'] });
  assert.equal((await p.validate()).ok, true);
  await p.set('page/view', { status: 'done', dependencies: ['page/model'] });
  await p.set('page', { status: 'done' });
  assert.equal((await p.validate()).ok, true);
  assert.equal((await p.health()).ok, true);
});

test('任务内部块后的人工标记贯穿完成校验、健康检查和下游认领', async t => {
  const p = await project(t);
  await p.create('page', { mode: 'parallel' });
  await p.create('page/review');
  await p.create('page/release', { dependencies: ['page/review'] });
  const continuations = [
    '  ```text\n  示例说明\n  ```\n  [人工] 对照实际页面\n',
    '  ### 验收步骤\n  [人工] 对照实际页面\n',
    '\n  [人工] 对照实际页面\n',
  ];
  for (const continuation of continuations) {
    const tasks = '- [x] 1.1 页面验收\n' + continuation;
    await p.set('page/review', { status: 'done', tasks });
    assert.equal(has(await p.validate(), 'human-review-required'), true, continuation);
    assert.equal(has(await p.health(), 'human-review-required'), true, continuation);
    await assert.rejects(() => p.claim('page/release'), /依赖验证/);
    await p.set('page/review', { status: 'done', tasks, review: 'passed' });
    assert.equal(has(await p.validate(), 'human-review-evidence-required'), true);
    await assert.rejects(() => p.claim('page/release'), /依赖验证/);
  }
  assert.equal((await p.doctor()).ok, false);
  await p.set('page/review', {
    status: 'done', tasks: '- [x] 1.1 [人工] 页面验收\n', review: 'passed',
    feedback: '人工确认页面默认态，测试设备配置下目标区域符合预期，通过。',
  });
  assert.equal((await p.claim('page/release')).claimed, true);
  assert.equal((await p.validate()).ok, true);
  assert.equal((await p.health()).ok, true);
});
