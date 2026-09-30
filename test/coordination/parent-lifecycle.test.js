import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { claimChange } from '../../src/coordination/claim.js';
import { parseComate } from '../../src/coordination/comate.js';
import { recordBaseline } from '../../src/coordination/baseline-store.js';
import { inspectBaseline } from '../../src/coordination/baseline-files.js';
import { validateCoordination } from '../../src/coordination/dag.js';
import { registerMapping } from '../../src/coordination/resolver.js';
import { writeTestBaseline } from '../helpers/baseline.js';
import { writeReviewedPreflight } from '../helpers/preflight.js';

const templatePath = path.resolve('templates/openspec/schemas/falla-spec-driven/templates/comate.md');

async function project(t) {
  const root = await mkdtemp('/private/tmp/falla-parent-lifecycle-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'openspec/changes/team');
  await mkdir(parent, { recursive: true });
  await writeReviewedPreflight(parent);
  const mapping = await registerMapping(root, 'team/worker');
  const child = path.join(root, 'openspec/changes', mapping.physical);
  await mkdir(child);
  const template = (await readFile(templatePath, 'utf8')).replace('execution-mode): single', 'execution-mode): parallel');
  await writeFile(path.join(parent, 'comate.md'), template);
  await writeFile(path.join(parent, 'tasks.md'), '- [ ] 1.1 验收汇总（依赖：无）\n');
  await writeFile(path.join(child, 'tasks.md'), '- [ ] 1.1 子实施（依赖：无）\n');
  await writeFile(path.join(child, 'comate.md'), template.replace(/- 执行模式 .*\n/u, ''));
  const official = physical => ({ changeName: physical,
    schemaName: physical === 'team' ? 'falla-spec-driven' : 'falla-task-driven', isPlanningComplete: true });
  const statusProvider = async physical => official(physical);
  const record = () => readFile(path.join(parent, 'comate.md'), 'utf8');
  const childRecord = () => readFile(path.join(child, 'comate.md'), 'utf8');
  const save = content => writeFile(path.join(parent, 'comate.md'), content);
  const options = { owner: 'lead', statusProvider };
  async function command(args) {
    const { transitionParent, transferParent } = await import('../../src/coordination/parent-lifecycle.js');
    return args[0] === 'transition'
      ? transitionParent(root, args[1] ?? 'team', { ...options, ...args[2] })
      : transferParent(root, args[1] ?? 'team', { ...options, ...args[2] });
  }
  return { root, parent, child, record, childRecord, save, statusProvider, options, command };
}

async function claim(p) {
  return claimChange(p.root, 'team', { ...p.options, coordinator: true });
}

function fillEvidence(markdown, humanReview = 'passed') {
  return markdown.replace('human-review): pending', `human-review): ${humanReview}`)
    .replace('  - 已完成：', '  - 已完成：当前里程碑已验证')
    .replace('  - 注释审计：', '  - 注释审计：无代码改动，不适用')
    .replace('  - 验证证据：', '  - 验证证据：核对当前父子交付及验收清单')
    .replace('  - 人工验证反馈：', '  - 人工验证反馈：用户明确确认合成里程碑通过')
    .replace('  - 安全与敏感信息结论：', '  - 安全与敏感信息结论：无正文输出；SECRET_EVIDENCE 不向诊断复制')
    .replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：无已知遗留风险；新变化先复核');
}

async function completeChild(p) {
  await writeFile(path.join(p.child, 'comate.md'), fillEvidence(await p.childRecord())
    .replace('owner): unassigned', 'owner): worker').replace('status): todo', 'status): done'));
  await writeFile(path.join(p.child, 'tasks.md'), '- [x] 1.1 子实施（依赖：无）\n');
  await writeTestBaseline(p.root, 'team/worker');
}

test('父 owner 可暂停恢复任务组，同状态幂等，任何步骤都不代改子记录', async t => {
  const p = await project(t);
  await claim(p);
  const beforeChild = await p.childRecord();
  await p.save((await p.record()).replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：等待用户确认，复核后恢复'));
  assert.deepEqual(await p.command(['transition', 'team', { status: 'blocked' }]), {
    change: 'team', role: 'coordinator', status: 'blocked', changed: true, idempotent: false,
  });
  const blocked = await p.record();
  assert.equal(parseComate(blocked).owner, 'lead');
  assert.deepEqual(await p.command(['transition', 'team', { status: 'blocked' }]), {
    change: 'team', role: 'coordinator', status: 'blocked', changed: false, idempotent: true,
  });
  assert.equal(await p.record(), blocked);
  await assert.rejects(claim(p), /blocked/);
  assert.equal((await p.command(['transition', 'team', { status: 'in-progress' }])).changed, true);
  assert.equal(await p.childRecord(), beforeChild);
});

test('父 done 在锁内检查子完成、父里程碑、handoff 和人工证据，失败不落盘', async t => {
  const p = await project(t);
  await claim(p);
  const before = await p.record();
  await assert.rejects(p.command(['transition', 'team', { status: 'done' }]), /完成|验证|门禁/);
  assert.equal(await p.record(), before);
  await completeChild(p);
  await writeFile(path.join(p.parent, 'tasks.md'), '- [x] 1.1 验收汇总（依赖：无）\n');
  const beforeEvidence = await p.record();
  await assert.rejects(p.command(['transition', 'team', { status: 'done' }]), /完成|验证|门禁/);
  assert.equal(await p.record(), beforeEvidence);
  await p.save(fillEvidence(await p.record()));
  const result = await p.command(['transition', 'team', { status: 'done' }]);
  assert.deepEqual(result, { change: 'team', role: 'coordinator', status: 'done', changed: true, idempotent: false });
  assert.equal(parseComate(await p.record()).status, 'done');
  assert.doesNotMatch(JSON.stringify(result), /lead|SECRET_EVIDENCE|用户明确确认/);
});

test('旧证据失效时父仍可安全暂停，恢复和完成仍受基线门禁约束', async t => {
  const p = await project(t);
  await claim(p);
  await p.save((await p.record()).replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：设计变更，先暂停再做影响复核'));
  await writeFile(path.join(p.parent, 'design.md'), '# 变更后的设计\n');
  assert.equal((await p.command(['transition', 'team', { status: 'blocked' }])).status, 'blocked');
  const blocked = await p.record();
  for (const status of ['in-progress', 'done']) {
    await assert.rejects(p.command(['transition', 'team', { status }]), /基线|验证|门禁/);
    assert.equal(await p.record(), blocked);
  }
});

test('父交接仅原 owner 可执行，保持状态/任务/基线/子记录，拒绝候选者抢占', async t => {
  const p = await project(t);
  await claim(p);
  await p.save((await p.record()).replace('  - 下一步准确操作：', '  - 下一步准确操作：已获用户确认交接，由 successor 继续验收；SECRET_TRANSFER'));
  const before = await p.record();
  const beforeChild = await p.childRecord();
  await assert.rejects(p.command(['transfer', 'team', { owner: 'successor', to: 'successor' }]), /owner|负责人/);
  assert.equal(await p.record(), before);
  const result = await p.command(['transfer', 'team', { to: 'successor' }]);
  assert.deepEqual(result, { change: 'team', role: 'coordinator', status: 'in-progress', transferred: true });
  assert.equal(await p.record(), before.replace('owner): lead', 'owner): successor'));
  assert.equal(await p.childRecord(), beforeChild);
  assert.doesNotMatch(JSON.stringify(result), /lead|successor|SECRET_TRANSFER/);
  await assert.rejects(p.command(['transition', 'team', { status: 'blocked' }]), /owner|负责人/);
});

test('父协调命令拒绝未认领、single、子引用、已归档与无效转移目标', async t => {
  const p = await project(t);
  const before = await p.record();
  await assert.rejects(p.command(['transition', 'team', { status: 'in-progress' }]), /认领|owner|负责人/);
  assert.equal(await p.record(), before);
  await claim(p);
  for (const to of ['unassigned', 'bad owner', 'x'.repeat(65)]) {
    await assert.rejects(p.command(['transfer', 'team', { to }]), /owner/);
  }
  await assert.rejects(p.command(['transition', 'team/worker', { status: 'blocked' }]), /父|parallel/);
  await assert.rejects(p.command(['transition', 'team-child-worker', { status: 'blocked' }]), /父|parallel/);
  await assert.rejects(p.command(['transition', 'team', { status: 'todo' }]), /状态/);
  await p.save((await p.record()).replace('execution-mode): parallel', 'execution-mode): single'));
  await assert.rejects(p.command(['transition', 'team', { status: 'blocked' }]), /parallel|模式/);
  await p.save((await p.record()).replace('execution-mode): single', 'execution-mode): parallel'));
  await mkdir(path.join(p.root, 'openspec/changes/archive'));
  await rename(p.parent, path.join(p.root, 'openspec/changes/archive/2026-09-30-team'));
  await assert.rejects(p.command(['transition', 'team', { status: 'blocked' }]), /归档/);
});

test('并发父交接和状态更新在真实项目锁内只有一个获准，失败不释放其他调用的锁', async t => {
  const p = await project(t);
  await claim(p);
  await p.save((await p.record()).replace('  - 下一步准确操作：', '  - 下一步准确操作：用户批准交接到 successor'));
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = p.command(['transfer', 'team', { to: 'successor', statusProvider: async physical => {
    entered(); await gate; return p.statusProvider(physical);
  } }]);
  try {
    await started;
    await assert.rejects(p.command(['transition', 'team', { status: 'blocked' }]), /正在进行/);
    assert.equal(parseComate(await p.record()).owner, 'lead');
  } finally { release(); }
  await first;
  assert.equal(parseComate(await p.record()).owner, 'successor');
});

test('父完成检查期间子 owner 撤销任务时拒绝旧验证结果，父不写 done', async t => {
  const p = await project(t);
  await claim(p);
  await completeChild(p);
  await writeFile(path.join(p.parent, 'tasks.md'), '- [x] 1.1 验收汇总（依赖：无）\n');
  await p.save(fillEvidence(await p.record()));
  const before = await p.record();
  await assert.rejects(p.command(['transition', 'team', { status: 'done', statusProvider: async physical => {
    if (physical !== 'team') await writeFile(path.join(p.child, 'tasks.md'), '- [ ] 1.1 子实施（依赖：无）\n');
    return p.statusProvider(physical);
  } }]), /变化|验证|门禁/);
  assert.equal(await p.record(), before);
});

test('更长的交接 owner 不得让合法上限记录超限后才报错，失败保持原文件', async t => {
  const p = await project(t);
  await claim(p);
  const text = (await p.record()).replace('  - 下一步准确操作：', '  - 下一步准确操作：用户批准交接');
  const remaining = 256 * 1024 - Buffer.byteLength(text);
  await p.save(`${text}${' '.repeat(remaining)}`);
  const before = await p.record();
  await assert.rejects(p.command(['transfer', 'team', { to: 'x'.repeat(64) }]), /无效|限制|过大/);
  assert.equal(await p.record(), before);
});


test('父转移遇到并发 handoff 修改时不覆盖新内容，锁在失败后可重新获得', async t => {
  const p = await project(t);
  await claim(p);
  await p.save((await p.record()).replace('  - 下一步准确操作：', '  - 下一步准确操作：用户确认由 successor 接手'));
  const changed = (await p.record()).replace('  - 当前任务：', '  - 当前任务：协调期间新增的本地说明');
  await assert.rejects(p.command(['transfer', 'team', { to: 'successor', statusProvider: async physical => {
    await p.save(changed);
    return p.statusProvider(physical);
  } }]), /不能覆盖|变化/);
  assert.equal(await p.record(), changed);
  assert.equal((await p.command(['transfer', 'team', { to: 'successor' }])).transferred, true);
});

test('父安全暂停与交接不读取符号链接正文，不触碰外部文件', async t => {
  const p = await project(t);
  await claim(p);
  const file = path.join(p.parent, 'comate.md');
  const original = await p.record();
  const outside = path.join(p.root, 'outside-secret.md');
  await writeFile(outside, 'PRIVATE_EXTERNAL_BODY\n');
  await unlink(file);
  await symlink(outside, file);
  for (const args of [['transition', 'team', { status: 'blocked' }], ['transfer', 'team', { to: 'successor' }]]) {
    await assert.rejects(p.command(args), error => error.code === 1 && !error.message.includes('PRIVATE_EXTERNAL_BODY'));
  }
  assert.equal(await readFile(outside, 'utf8'), 'PRIVATE_EXTERNAL_BODY\n');
  await unlink(file);
  await p.save(original.replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：核对文件恢复后暂停'));
  assert.equal((await p.command(['transition', 'team', { status: 'blocked' }])).status, 'blocked');
});


test('旧无父协调者且子有旧进度时先暂停、初始化父基线、逐子复核再认领，不追认旧身份', async t => {
  const p = await project(t);
  const view = await registerMapping(p.root, 'team/view');
  const viewDir = path.join(p.root, 'openspec/changes', view.physical);
  await mkdir(viewDir);
  const childTemplate = await p.childRecord();
  const upstream = fillEvidence(childTemplate).replace('owner): unassigned', 'owner): worker')
    .replace('status): todo', 'status): done').replace('human-review): pending', 'human-review): not-required');
  await writeFile(path.join(p.child, 'comate.md'), upstream);
  await writeFile(path.join(p.child, 'tasks.md'), '- [x] 1.1 子实施（依赖：无）\n');
  await writeFile(path.join(viewDir, 'comate.md'), fillEvidence(childTemplate).replace('owner): unassigned', 'owner): view-owner')
    .replace('status): todo', 'status): in-progress').replace('depends-on): []', 'depends-on): [team/worker]')
    .replace('human-review): pending', 'human-review): not-required'));
  await writeFile(path.join(viewDir, 'tasks.md'), '- [ ] 1.1 消费子交付（依赖：无）\n');
  const beforeParent = await p.record();
  await assert.rejects(claim(p), /基线|验证/);
  assert.equal(await p.record(), beforeParent);
  // 原子 owner 只暂停自己的记录，不手工指定父 owner，不清空有效的已完成 checkbox。
  await writeFile(path.join(p.child, 'comate.md'), upstream.replace('status): done', 'status): blocked'));
  await writeFile(path.join(viewDir, 'comate.md'), (await readFile(path.join(viewDir, 'comate.md'), 'utf8'))
    .replace('status): in-progress', 'status): blocked'));
  await recordBaseline(p.root, 'team', { owner: 'lead' });
  assert.equal(parseComate(await p.record()).owner, 'unassigned');
  assert.equal(parseComate(await p.record()).status, 'todo');
  for (const [reference, directory, owner] of [['team/worker', p.child, 'worker'], ['team/view', viewDir, 'view-owner']]) {
    const state = await inspectBaseline(p.root, reference);
    const review = { from: null, to: state.current.fingerprint, affected: [], preserved: ['1.1'],
      evidence: '用户及当前证据明确核验旧任务，无变化，保留既有有效进度；恢复前仍核对当前父身份' };
    const file = path.join(directory, 'comate.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('baseline-review): none', `baseline-review): ${JSON.stringify(review)}`));
    await recordBaseline(p.root, reference, { owner });
  }
  await claim(p);
  assert.equal(parseComate(await p.childRecord()).owner, 'worker');
  assert.match(await readFile(path.join(p.child, 'tasks.md'), 'utf8'), /\[x\]/);
  await writeFile(path.join(p.child, 'comate.md'), (await p.childRecord()).replace('status): blocked', 'status): done'));
  await writeFile(path.join(viewDir, 'comate.md'), (await readFile(path.join(viewDir, 'comate.md'), 'utf8'))
    .replace('status): blocked', 'status): in-progress'));
  const statusProvider = async physical => ({ changeName: physical,
    schemaName: physical === 'team' ? 'falla-spec-driven' : 'falla-task-driven', isPlanningComplete: true });
  assert.equal((await validateCoordination(p.root, { change: 'team', statusProvider })).ok, true);
  assert.equal((await claimChange(p.root, 'team/view', { owner: 'view-owner', statusProvider })).idempotent, true);
});
