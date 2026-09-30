import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { validateChangeRecords } from '../../src/coordination/health.js';
import { writeTestBaseline } from '../helpers/baseline.js';

const execute = promisify(execFile);
const repo = process.cwd();
const officialExecutable = path.join(repo, 'node_modules/.bin/openspec');
const fallaExecutable = path.join(repo, 'bin/falla-openspec.js');
const reviewTasks = `<!-- falla-tasks-format: 1 -->
## 1. 验收
- [ ] 1.1 [人工] 页面一确认（依赖：无）
- [ ] 1.2 页面一交付（依赖：1.1）
- [ ] 1.3 [人工] 页面二确认（依赖：无）
- [ ] 1.4 页面二交付（依赖：1.3）
`;
const ordinaryTasks = '<!-- falla-tasks-format: 1 -->\n## 1. 交付\n- [ ] 1.1 交付（依赖：无）\n';
const parentTasks = '<!-- falla-tasks-format: 1 -->\n## 1. 协调\n- [ ] 1.1 [人工] 总体验收（依赖：无）\n';

async function fixture(t, parallel = false) {
  const root = await mkdtemp('/private/tmp/falla-human-result-gates-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, PATH: `${path.dirname(officialExecutable)}${path.delimiter}${process.env.PATH}` };
  async function run(executable, args) {
    try {
      const output = await execute(executable, args, { cwd: root, env, timeout: 20000, maxBuffer: 512 * 1024 });
      return { code: 0, ...output, value: args.includes('--json') ? JSON.parse(output.stdout) : null };
    } catch (error) {
      if (typeof error.code !== 'number' || error.killed) throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr,
        value: args.includes('--json') && error.stdout.trim() ? JSON.parse(error.stdout) : null };
    }
  }
  const official = (...args) => run(officialExecutable, [...args, '--json']);
  const falla = (...args) => run(process.execPath, [fallaExecutable, 'coordination', ...args, '--json']);
  const pass = async promise => {
    const result = await promise;
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_/);
    return result.value;
  };
  const fail = async promise => {
    const result = await promise;
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_/);
    return result;
  };
  assert.equal((await run(officialExecutable, ['init', '--tools', 'none', '.'])).code, 0);
  await cp(path.join(repo, 'templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  const directories = new Map();
  async function create(reference, tasks, { mode = 'hybrid', dependencies = [] } = {}) {
    const child = reference.includes('/');
    const physical = child ? (await pass(falla('register', reference))).physical : reference;
    await pass(official('new', 'change', physical, '--schema', child ? 'falla-task-driven' : 'falla-spec-driven'));
    const directory = path.join(root, 'openspec/changes', physical);
    directories.set(reference, directory);
    if (!child) {
      await writeFile(path.join(directory, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
      await writeFile(path.join(directory, 'preflight.md'), '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# 合成需求\n');
      await writeFile(path.join(directory, 'proposal.md'), '# 合成范围\n人工确认之后再交付。\n');
      await writeFile(path.join(directory, 'design.md'), '# 合成设计\n先验收，再交付。\n');
    }
    const schema = child ? 'falla-task-driven' : 'falla-spec-driven';
    let text = await readFile(path.join(repo, `templates/openspec/schemas/${schema}/templates/comate.md`), 'utf8');
    if (parallel && !child) text = text.replace('execution-mode): single', 'execution-mode): parallel');
    text = text.replace('validation-mode): hybrid', `validation-mode): ${mode}`)
      .replace('depends-on): []', `depends-on): [${dependencies.join(', ')}]`)
      .replace('  - 已完成：', '  - 已完成：本轮合法进度')
      .replace('  - 注释审计：', '  - 注释审计：无代码修改，不适用')
      .replace('  - 验证证据：', '  - 验证证据：合成任务定向校验')
      .replace('  - 安全与敏感信息结论：', '  - 安全与敏感信息结论：不输出 PRIVATE_BODY')
      .replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：按人工结果恢复');
    if (mode !== 'human' && !tasks.includes('[人工]')) text = text.replace('human-review): pending', 'human-review): not-required');
    await writeFile(path.join(directory, 'tasks.md'), tasks);
    await writeFile(path.join(directory, 'comate.md'), text);
    return physical;
  }
  const record = reference => readFile(path.join(directories.get(reference), 'comate.md'), 'utf8');
  const save = (reference, text) => writeFile(path.join(directories.get(reference), 'comate.md'), text);
  const tasks = (reference, text) => writeFile(path.join(directories.get(reference), 'tasks.md'), text);
  async function results(reference, entries) {
    const text = await record(reference);
    const field = `- 人工任务结果 (human-task-results): ${JSON.stringify(entries)}`;
    await save(reference, /^- 人工任务结果 \(human-task-results\):/mu.test(text)
      ? text.replace(/^- 人工任务结果 \(human-task-results\):.*$/mu, field)
      : text.replace('- 依赖 (depends-on):', `${field}\n- 依赖 (depends-on):`));
  }
  const validate = () => falla('validate', '--change', 'page');
  const health = async () => validateChangeRecords(root, (await pass(official('status', '--all'))).changes);
  await create('page', parallel ? parentTasks : reviewTasks);
  return { root, directories, create, official, falla, pass, fail, record, save, tasks, results, validate, health };
}

test('真实 CLI 在检查点及同 owner 认领拒绝无人工结果的勾选，合法部分通过只需结果', async t => {
  const p = await fixture(t);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.tasks('page', reviewTasks.replace('[ ] 1.1', '[x] 1.1'));
  const before = await p.record('page');
  const report = await p.fail(p.validate());
  assert.ok(report.value.errors.some(({ kind, details }) => kind === 'human-task-result-required' && details?.task === '1.1'));
  assert.ok((await p.health()).errors.some(({ kind }) => kind === 'human-task-result-required'));
  await p.fail(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  assert.equal(await p.record('page'), before);
  await p.results('page', [['1.1', 'passed'], ['1.3', 'pending']]);
  await p.pass(p.validate());
  assert.equal((await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'))).idempotent, true);
  await p.tasks('page', reviewTasks.replace('[ ] 1.1', '[x] 1.1').replace('[ ] 1.2', '[x] 1.2'));
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
  await p.tasks('page', reviewTasks.replace('[ ] 1.1', '[x] 1.1').replace('[ ] 1.2', '[x] 1.2').replace('[ ] 1.4', '[x] 1.4'));
  const blocked = await p.fail(p.validate());
  assert.ok(blocked.value.errors.some(({ kind }) => kind === 'task-dependency-not-done'));
});

test('人工结果撤销后已完成任务及其下游不得继续，局部回退保留其他通过结果', async t => {
  const p = await fixture(t);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.results('page', [['1.1', 'passed'], ['1.3', 'passed']]);
  await p.tasks('page', reviewTasks.replaceAll('[ ]', '[x]'));
  await p.pass(p.validate());
  await p.results('page', [['1.1', 'failed'], ['1.3', 'passed']]);
  const before = await p.record('page');
  await p.fail(p.validate());
  await p.fail(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  assert.equal(await p.record('page'), before);
  await p.tasks('page', reviewTasks.replace('[ ] 1.3', '[x] 1.3').replace('[ ] 1.4', '[x] 1.4'));
  await p.pass(p.validate());
  assert.equal((await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'))).idempotent, true);
});

test('parallel 子人工结果未通过不解锁依赖子，父完成同样只检查本父人工结果', async t => {
  const p = await fixture(t, true);
  await p.create('page/review', reviewTasks);
  await p.create('page/next', ordinaryTasks, { dependencies: ['page/review'] });
  await p.pass(p.falla('claim', 'page', '--coordinator', '--owner', 'PRIVATE_LEAD'));
  await p.pass(p.falla('claim', 'page/review', '--owner', 'PRIVATE_REVIEWER'));
  await p.tasks('page/review', reviewTasks.replaceAll('[ ]', '[x]'));
  await p.save('page/review', (await p.record('page/review')).replace('status): in-progress', 'status): done')
    .replace('human-review): pending', 'human-review): passed'));
  const invalid = await p.fail(p.validate());
  assert.ok(invalid.value.errors.some(({ kind, change }) => kind === 'human-task-result-required' && change === 'page/review'));
  assert.deepEqual(invalid.value.ready, []);
  await p.fail(p.falla('claim', 'page/next', '--owner', 'PRIVATE_NEXT'));
  await p.results('page/review', [['1.1', 'passed'], ['1.3', 'passed']]);
  const valid = await p.pass(p.validate());
  assert.deepEqual(valid.ready, ['page/next']);
  await p.pass(p.falla('claim', 'page/next', '--owner', 'PRIVATE_NEXT'));
  await p.tasks('page/next', ordinaryTasks.replace('[ ]', '[x]'));
  await p.save('page/next', (await p.record('page/next')).replace('status): in-progress', 'status): done'));
  await p.tasks('page', parentTasks.replace('[ ]', '[x]'));
  await p.save('page', (await p.record('page')).replace('human-review): pending', 'human-review): passed'));
  const parentBefore = await p.record('page');
  await p.fail(p.falla('transition', 'page', '--owner', 'PRIVATE_LEAD', '--status', 'done'));
  assert.equal(await p.record('page'), parentBefore);
  await p.results('page', [['1.1', 'passed']]);
  await p.pass(p.falla('transition', 'page', '--owner', 'PRIVATE_LEAD', '--status', 'done'));
  assert.equal((await p.health()).ok, true);
});

test('基线复核只清除受影响人工 passed，其他通过结果保持，不能用刷新基线追认', async t => {
  const p = await fixture(t);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.results('page', [['1.1', 'passed'], ['1.3', 'passed']]);
  await p.tasks('page', reviewTasks.replaceAll('[ ]', '[x]'));
  const previous = await p.pass(p.falla('baseline', 'page'));
  await writeFile(path.join(p.directories.get('page'), 'design.md'), '# 合成设计\n页面一修订，页面二保持。\n');
  const changed = await p.fail(p.falla('baseline', 'page'));
  await p.tasks('page', reviewTasks.replace('[ ] 1.3', '[x] 1.3').replace('[ ] 1.4', '[x] 1.4'));
  const review = { from: previous.current.fingerprint, to: changed.value.current.fingerprint,
    affected: ['1.1', '1.2'], preserved: ['1.3', '1.4'], evidence: '页面一需重验，页面二已核对未受影响' };
  await p.save('page', (await p.record('page')).replace('baseline-review): none', `baseline-review): ${JSON.stringify(review)}`));
  const before = await p.record('page');
  await p.fail(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'));
  assert.equal(await p.record('page'), before);
  await p.results('page', [['1.1', 'pending'], ['1.3', 'passed']]);
  await p.pass(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'));
  await p.pass(p.validate());
  assert.equal((await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'))).idempotent, true);
  const state = await p.record('page');
  assert.match(state, /\[\["1.1","pending"\],\["1.3","passed"\]\]/);
  assert.match(await readFile(path.join(p.directories.get('page'), 'tasks.md'), 'utf8'), /\[x\] 1.3/);
});

test('旧笼统人工通过不能代替逐项结果；显式补结果后无需反馈正文即可完成', async t => {
  const p = await fixture(t);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.tasks('page', reviewTasks.replaceAll('[ ]', '[x]'));
  await p.save('page', (await p.record('page'))
    .replace('status): in-progress', 'status): done')
    .replace('human-review): pending', 'human-review): passed')
    .replace(/^- 人工任务结果 \(human-task-results\):.*\n/mu, '')
    .replace('  - 人工验证反馈：', '  - 人工验证反馈：旧笼统确认，PRIVATE_FEEDBACK'));
  const before = await p.record('page');
  assert.equal((await p.pass(p.official('instructions', 'apply', '--change', 'page'))).state, 'all_done');
  const invalid = await p.fail(p.validate());
  assert.ok(invalid.value.errors.some(({ kind }) => kind === 'human-task-result-required'));
  assert.equal(await p.record('page'), before);
  await p.results('page', [['1.1', 'passed'], ['1.3', 'passed']]);
  await p.save('page', (await p.record('page')).replace('  - 人工验证反馈：旧笼统确认，PRIVATE_FEEDBACK', '  - 人工验证反馈：'));
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
});

test('真实 CLI 拒绝非法/重复人工结果且不回显输入，失败不修改任务或协作记录', async t => {
  const p = await fixture(t);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.tasks('page', reviewTasks.replace('[ ] 1.1', '[x] 1.1'));
  for (const entries of [
    [['PRIVATE_TASK', 'passed']], [['1.1', 'PRIVATE_RESULT']],
    [['1.1', 'passed'], ['1.1', 'failed']], [['1.1', 'passed', 'PRIVATE_EVIDENCE']],
  ]) {
    await p.results('page', entries);
    const before = await p.record('page');
    const tasks = await readFile(path.join(p.directories.get('page'), 'tasks.md'), 'utf8');
    await p.fail(p.validate());
    await p.fail(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
    assert.equal(await p.record('page'), before);
    assert.equal(await readFile(path.join(p.directories.get('page'), 'tasks.md'), 'utf8'), tasks);
  }
});


// 模拟已有合法快照的旧记录，不能通过新 claim 重写历史进度或基线。
async function seedLegacyRecord(p, tasks, { status = 'done', review = 'passed' } = {}) {
  await p.tasks('page', tasks);
  await p.save('page', (await p.record('page'))
    .replace('owner): unassigned', 'owner): PRIVATE_OWNER')
    .replace('status): todo', `status): ${status}`)
    .replace('human-review): pending', `human-review): ${review}`));
  await writeTestBaseline(p.root, 'page');
  return p.pass(p.falla('baseline', 'page'));
}

test('旧围栏人工续行在真实 DAG/health 中仍受门禁，补结果不改原任务或基线', async t => {
  const p = await fixture(t);
  const tasks = '```md\n- [x] 1.1 页面验收\n  [人工] 本项必须人工确认\n```\n';
  const initial = await seedLegacyRecord(p, tasks, { review: 'not-required' });
  const before = await p.record('page');
  const report = await p.fail(p.validate());
  assert.ok(report.value.errors.some(({ kind }) => kind === 'human-task-result-required'));
  assert.ok(report.value.errors.some(({ kind }) => kind === 'human-review-required'));
  assert.equal((await p.health()).ok, false);
  assert.equal(await p.record('page'), before);
  await p.results('page', [['1.1', 'passed']]);
  await p.save('page', (await p.record('page')).replace('human-review): not-required', 'human-review): passed'));
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
  assert.equal((await p.pass(p.falla('baseline', 'page'))).current.fingerprint, initial.current.fingerprint);
  assert.equal(await readFile(path.join(p.directories.get('page'), 'tasks.md'), 'utf8'), tasks);
});

test('旧围栏内人工任务已有编号时仅补本项 passed 即可恢复，不要求改任务定义', async t => {
  const p = await fixture(t);
  const tasks = '```md\n- [x] 1.1 [人工] 旧页面验收\n```\n';
  const initial = await seedLegacyRecord(p, tasks);
  await p.fail(p.validate());
  await p.results('page', [['1.1', 'passed']]);
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
  assert.equal((await p.pass(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'))).recorded, false);
  assert.equal((await p.pass(p.falla('baseline', 'page'))).current.fingerprint, initial.current.fingerprint);
  assert.equal(await readFile(path.join(p.directories.get('page'), 'tasks.md'), 'utf8'), tasks);
});

test('嵌套代码示例的人工标记不阻断已完成普通任务，同 owner 重试与基线记录均可用', async t => {
  const p = await fixture(t);
  const tasks = '- [x] 1.1 普通自动检查\n  ```md\n  - [ ] 1.2 [人工] 仅作示例\n  ```\n';
  const initial = await seedLegacyRecord(p, tasks, { status: 'in-progress', review: 'pending' });
  const before = await p.record('page');
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
  assert.equal((await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'))).idempotent, true);
  assert.equal((await p.pass(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'))).recorded, false);
  assert.equal(await p.record('page'), before);
  assert.equal((await p.pass(p.falla('baseline', 'page'))).current.fingerprint, initial.current.fingerprint);
});

test('人工续行归属与基线正文归属不同时，复核仍不得保留受影响项旧 passed', async t => {
  const p = await fixture(t);
  const tasks = '<!-- falla-tasks-format: 1 -->\n## 1. 验收\n- [ ] 1.1 页面验收（依赖：无）\n ## 本项验收\n [人工] 页面确认\n';
  await p.tasks('page', tasks);
  await p.pass(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
  await p.results('page', [['1.1', 'passed']]);
  await p.tasks('page', tasks.replace('[ ]', '[x]'));
  await p.pass(p.validate());
  const initial = await p.pass(p.falla('baseline', 'page'));
  await writeFile(path.join(p.directories.get('page'), 'design.md'), '# 页面验收条件修订\n');
  const changed = await p.fail(p.falla('baseline', 'page'));
  await p.tasks('page', tasks);
  const review = { from: initial.current.fingerprint, to: changed.value.current.fingerprint,
    affected: ['1.1'], preserved: [], evidence: '当前页面条件改变，原人工结果需重新取得' };
  await p.save('page', (await p.record('page')).replace('baseline-review): none', `baseline-review): ${JSON.stringify(review)}`));
  const before = await p.record('page');
  await p.fail(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'));
  assert.equal(await p.record('page'), before);
  await p.results('page', [['1.1', 'pending']]);
  await p.pass(p.falla('baseline', 'page', '--record', '--owner', 'PRIVATE_OWNER'));
  await p.tasks('page', tasks.replace('[ ]', '[x]'));
  await p.fail(p.validate());
  await p.results('page', [['1.1', 'passed']]);
  await p.pass(p.validate());
  assert.equal((await p.health()).ok, true);
});

test('旧正文与围栏同编号的人工结果在 DAG/health/认领中均拒绝歧义', async t => {
  const p = await fixture(t);
  for (const tasks of [
    '- [x] 1.1 [人工] 页面一\n\n```md\n- [x] 1.1 [人工] 页面二\n```\n',
    '- [x] 1.1 [人工] 页面一\n\n```md\n- [ ] 1.1 普通示例\n```\n',
  ]) {
    await seedLegacyRecord(p, tasks, { status: 'in-progress', review: 'pending' });
    await p.results('page', [['1.1', 'passed']]);
    const before = await p.record('page');
    const report = await p.fail(p.validate());
    assert.ok(report.value.errors.some(({ kind }) => kind === 'human-task-id-ambiguous'));
    assert.ok((await p.health()).errors.some(({ kind }) => kind === 'human-task-id-ambiguous'));
    await p.fail(p.falla('claim', 'page', '--owner', 'PRIVATE_OWNER'));
    assert.equal(await p.record('page'), before);
  }
});
