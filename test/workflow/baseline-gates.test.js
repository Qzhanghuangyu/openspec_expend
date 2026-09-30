import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { coordinationCommand } from '../../src/commands/coordination.js';
import { inspectBaseline } from '../../src/coordination/baseline-files.js';
import { validateChangeRecords } from '../../src/coordination/health.js';
import { main } from '../../src/cli.js';

const exec = promisify(execFile);
const clear = '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# Preflight\n已核对合成需求\n';
const tasks = '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 文案（依赖：无）\n';
async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-baseline-workflow-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.resolve('node_modules/.bin/openspec');
  const io = { cwd: root, env: process.env, openSpecExecutable: executable, stdout: {write() {}}, stderr: {write() {}} };
  const official = async (...args) => JSON.parse((await exec(executable, [...args, '--json'], { cwd: root })).stdout);
  await exec(executable, ['init', '--tools', 'none', '.'], { cwd: root });
  await cp(path.resolve('templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  const command = (...args) => coordinationCommand([...args, '--json'], io);
  const files = new Map();
  async function create(reference, mode = 'single', dependencies = [], seed = true) {
    const child = reference.includes('/');
    const physical = child ? (await command('register', reference)).physical : reference;
    await official('new', 'change', physical, '--schema', child ? 'falla-task-driven' : 'falla-spec-driven');
    const dir = path.join(root, 'openspec/changes', physical);
    files.set(reference, dir);
    if (!child) {
      await writeFile(path.join(dir, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
      await writeFile(path.join(dir, 'preflight.md'), clear);
      await writeFile(path.join(dir, 'proposal.md'), '# 范围\n仅文案调整\n');
      await writeFile(path.join(dir, 'design.md'), '# 设计\n旧文案\n');
    }
    await writeFile(path.join(dir, 'tasks.md'), tasks);
    await writeFile(path.join(dir, 'comate.md'), `# comate\n- 格式版本 (format-version): 2\n${child ? '' : `- 执行模式 (execution-mode): ${mode}\n`}- 负责人 (owner): unassigned\n- 状态 (status): todo\n- 验证模式 (validation-mode): hybrid\n- 人工验证状态 (human-review): not-required\n- 依赖 (depends-on): [${dependencies.join(', ')}]\n- 交接 (handoff):\n  - 已完成：旧文案任务\n  - 注释审计：无代码改动\n  - 验证证据：已核对旧文案\n  - 安全与敏感信息结论：仅合成数据\n  - 遗留风险与恢复条件：按当前基线复核\n`);
    if (seed) await command('baseline', reference, '--record', '--owner', 'alice');
    return { dir, physical };
  }
  async function finish(reference) {
    if (reference.includes('/')) {
      const parent = reference.split('/')[0];
      const parentText = await readFile(path.join(files.get(parent), 'comate.md'), 'utf8');
      if (parentText.includes('status): todo')) await command('claim', parent, '--coordinator', '--owner', 'alice');
    }
    const dir = files.get(reference);
    await writeFile(path.join(dir, 'tasks.md'), tasks.replace('[ ]', '[x]'));
    const file = path.join(dir, 'comate.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('owner): unassigned', 'owner): alice')
      .replace(/status\): (?:todo|in-progress)/u, 'status): done'));
  }
  const validate = reference => command('validate', '--change', reference);
  const health = async () => validateChangeRecords(root, (await official('status', '--all')).changes);
  const claim = reference => command('claim', reference, '--owner', 'alice');
  return { root, io, command, official, files, create, finish, validate, health, claim };
}

const has = (report, kind) => report.errors.some(error => error.kind === kind);

test('真实 OpenSpec all_done 不能覆盖已改变设计的失效完成证据，validate/doctor 共用门禁', async t => {
  const p = await fixture(t);
  const { dir } = await p.create('page');
  await p.finish('page');
  assert.equal((await p.validate('page')).ok, true);
  const before = await readFile(path.join(dir, 'comate.md'), 'utf8');
  await writeFile(path.join(dir, 'design.md'), '# 设计\nPRIVATE_NEW_BEHAVIOR：新文案，尚未复验\n');
  assert.equal((await p.official('instructions', 'apply', '--change', 'page')).state, 'all_done');
  for (const result of [await p.validate('page'), await p.health()]) {
    assert.equal(has(result, 'baseline-review-required'), true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NEW_BEHAVIOR/);
  }
  assert.equal(await readFile(path.join(dir, 'comate.md'), 'utf8'), before);
  assert.ok((await readFile(path.join(dir, 'tasks.md'), 'utf8')).includes('[x]'));
});

test('首次 claim 自动初始化无进度记录，同 owner 重试遇到基线改变拒绝且不写字段', async t => {
  const p = await fixture(t);
  const { dir } = await p.create('page', 'single', [], false);
  assert.equal((await p.claim('page')).claimed, true);
  const file = path.join(dir, 'comate.md');
  const claimed = await readFile(file, 'utf8');
  assert.match(claimed, /实施基线 \(baseline\)/);
  assert.equal((await p.claim('page')).idempotent, true);
  await writeFile(path.join(dir, 'design.md'), '# 新设计\n需要重规划\n');
  await assert.rejects(() => p.claim('page'), /基线|复核/);
  assert.equal(await readFile(file, 'utf8'), claimed);
});

test('parallel 与跨父依赖的旧 done 基线失效时下游不得认领；只读检查逻辑/物理名一致', async t => {
  const p = await fixture(t);
  const upstream = await p.create('foundation');
  await p.finish('foundation');
  const parent = await p.create('page', 'parallel');
  await p.create('page/source');
  await p.finish('page/source');
  const downstream = await p.create('page/next', 'single', ['page/source', 'foundation']);
  await writeFile(path.join(upstream.dir, 'design.md'), '# 上游契约改变\n');
  assert.ok(has(await p.validate('page'), 'baseline-review-required'));
  await assert.rejects(() => p.claim('page/next'), /基线|复核/);
  await writeFile(path.join(upstream.dir, 'design.md'), '# 设计\n旧文案\n');
  await writeFile(path.join(parent.dir, 'design.md'), '# 父设计改变\n');
  assert.ok(has(await p.validate('page'), 'baseline-review-required'));
  await assert.rejects(() => p.claim('page/next'), /基线|复核/);
  assert.equal((await p.command('baseline', 'page/next')).current.fingerprint,
    (await p.command('baseline', downstream.physical)).current.fingerprint);
});

test('旧 done 缺基线不得成为下游证据，归档只检查不补写', async t => {
  const p = await fixture(t);
  const old = await p.create('old', 'single', [], false);
  await p.finish('old');
  const archive = await p.official('archive', 'old', '--yes');
  const file = path.join(archive.archive.path, 'comate.md');
  const before = await readFile(file, 'utf8');
  await p.create('page', 'single', ['old'], false);
  assert.ok(has(await p.validate('page'), 'baseline-unverified'));
  await assert.rejects(() => p.claim('page'), /基线|复核/);
  await assert.rejects(() => p.command('baseline', 'old', '--record', '--owner', 'alice'), /归档/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('只读基线检查失败返回非零；无 record 的 owner 或 record 缺 owner 参数均拒绝', async t => {
  const p = await fixture(t);
  const { dir } = await p.create('page');
  assert.equal(await main(['coordination', 'baseline', 'page', '--json'], p.io), 0);
  await writeFile(path.join(dir, 'design.md'), '# 新设计\n');
  assert.equal(await main(['coordination', 'baseline', 'page', '--json'], p.io), 1);
  await assert.rejects(() => p.command('baseline', 'page', '--owner', 'alice'), /owner/);
  await assert.rejects(() => p.command('baseline', 'page', '--record'), /owner/);
  assert.equal((await inspectBaseline(p.root, 'page')).ok, false);
});

test('已完成记录改任务完成条件不能刷新通过，回退受影响项后可保留其余进度再恢复', async t => {
  const p = await fixture(t);
  const { dir } = await p.create('page');
  const twoTasks = tasks + '- [ ] 1.2 独立说明（依赖：无）\n';
  await writeFile(path.join(dir, 'tasks.md'), twoTasks);
  const old = await p.command('baseline', 'page');
  let file = path.join(dir, 'comate.md');
  let record = await readFile(file, 'utf8');
  const firstReview = { from: old.recorded.fingerprint, to: old.current.fingerprint,
    affected: ['1.2'], preserved: ['1.1'], evidence: '已核对新增说明任务，旧任务尚未实施' };
  await writeFile(file, `- 基线复核 (baseline-review): ${JSON.stringify(firstReview)}\n${record}`);
  await p.command('baseline', 'page', '--record', '--owner', 'alice');
  await p.claim('page');
  await writeFile(path.join(dir, 'tasks.md'), twoTasks.replaceAll('[ ]', '[x]'));
  record = (await readFile(file, 'utf8')).replace('status): in-progress', 'status): done');
  await writeFile(file, record);
  assert.equal((await p.validate('page')).ok, true);
  await writeFile(path.join(dir, 'tasks.md'), twoTasks.replaceAll('[ ]', '[x]').replace('1.1 文案', '1.1 新文案'));
  const changed = await p.command('baseline', 'page');
  assert.ok(changed.changedTasks.includes('1.1'));
  const review = { from: changed.recorded.fingerprint, to: changed.current.fingerprint,
    affected: ['1.1'], preserved: ['1.2'], evidence: '新文案需重做；独立说明没有改变并核实既有证据' };
  record = record.replace(/^- 基线复核 \(baseline-review\):.*\n/gmu, '');
  await writeFile(file, `- 基线复核 (baseline-review): ${JSON.stringify(review)}\n${record}`);
  await assert.rejects(() => p.command('baseline', 'page', '--record', '--owner', 'alice'), /复核/);
  await writeFile(path.join(dir, 'tasks.md'), twoTasks.replace('1.1 文案', '1.1 新文案').replace('[ ] 1.2', '[x] 1.2'));
  await writeFile(file, `- 基线复核 (baseline-review): ${JSON.stringify(review)}\n${record.replace('status): done', 'status): in-progress')}`);
  await p.command('baseline', 'page', '--record', '--owner', 'alice');
  assert.equal((await p.validate('page')).ok, true);
  assert.match(await readFile(path.join(dir, 'tasks.md'), 'utf8'), /\[x\] 1\.2/);
  assert.equal((await p.claim('page')).idempotent, true);
});

test('非法基线引用不回显原始内容，真实进程 stdout/stderr 仅返回脱敏错误', async t => {
  const p = await fixture(t);
  const { stdout, stderr } = await exec(process.execPath,
    [path.resolve('bin/falla-openspec.js'), 'coordination', 'baseline', 'PRIVATE_BODY/invalid/third', '--json'],
    { cwd: p.root, timeout: 5000, maxBuffer: 64 * 1024 }).then(result => result, error => {
      assert.equal(error.code, 1);
      return { stdout: error.stdout, stderr: error.stderr };
    });
  assert.doesNotMatch(stdout + stderr, /PRIVATE_BODY/u);
});

test('上游复核并重新 done 后，下游旧完成快照仍失效直到自己的影响复核', async t => {
  const p = await fixture(t);
  const producer = await p.create('producer');
  await p.finish('producer');
  const consumer = await p.create('consumer', 'single', ['producer']);
  await p.finish('consumer');
  const file = path.join(consumer.dir, 'comate.md');
  const before = await readFile(file, 'utf8');
  assert.equal((await p.validate('consumer')).ok, true);
  const producerFile = path.join(producer.dir, 'comate.md');
  let producerRecord = (await readFile(producerFile, 'utf8')).replace('status): done', 'status): in-progress');
  await writeFile(path.join(producer.dir, 'tasks.md'), tasks);
  await writeFile(path.join(producer.dir, 'design.md'), '# 新交付契约\n');
  const producerBaseline = await p.command('baseline', 'producer');
  const producerReview = { from: producerBaseline.recorded.fingerprint, to: producerBaseline.current.fingerprint,
    affected: ['1.1'], preserved: [], evidence: '上游交付契约改变，任务已回退需复验' };
  await writeFile(producerFile, `- 基线复核 (baseline-review): ${JSON.stringify(producerReview)}\n${producerRecord}`);
  await p.command('baseline', 'producer', '--record', '--owner', 'alice');
  await p.finish('producer');
  assert.equal((await p.official('instructions', 'apply', '--change', 'consumer')).state, 'all_done');
  assert.ok(has(await p.validate('consumer'), 'baseline-review-required'));
  assert.ok(has(await p.health(), 'baseline-review-required'));
  assert.equal(await readFile(file, 'utf8'), before);
  assert.ok((await readFile(path.join(consumer.dir, 'tasks.md'), 'utf8')).includes('[x]'));
  const changed = await p.command('baseline', 'consumer');
  const consumerReview = { from: changed.recorded.fingerprint, to: changed.current.fingerprint,
    affected: [], preserved: ['1.1'], evidence: '已核对新上游交付，消费者行为与完成证据仍适用' };
  await writeFile(file, `- 基线复核 (baseline-review): ${JSON.stringify(consumerReview)}\n${before}`);
  await p.command('baseline', 'consumer', '--record', '--owner', 'alice');
  assert.equal((await p.validate('consumer')).ok, true);
});

test('跨父依赖子节点时，其父的前置依赖回退也阻断消费者，但不要求父先 done', async t => {
  const p = await fixture(t);
  const foundation = await p.create('foundation');
  await p.finish('foundation');
  await p.create('producer', 'parallel', ['foundation']);
  await p.create('producer/source');
  await p.finish('producer/source');
  const consumer = await p.create('consumer', 'single', ['producer/source']);
  assert.equal((await p.validate('consumer')).ok, true);
  const foundationFile = path.join(foundation.dir, 'comate.md');
  await writeFile(foundationFile, (await readFile(foundationFile, 'utf8')).replace('status): done', 'status): blocked'));
  const before = await readFile(path.join(consumer.dir, 'comate.md'), 'utf8');
  assert.equal((await p.validate('consumer')).ok, false);
  await assert.rejects(() => p.claim('consumer'), /依赖|验证|基线/);
  assert.equal(await readFile(path.join(consumer.dir, 'comate.md'), 'utf8'), before);
});
