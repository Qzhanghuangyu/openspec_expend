import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { parseComate } from '../../src/coordination/comate.js';

const execute = promisify(execFile);
const repo = process.cwd();
const officialExecutable = path.join(repo, 'node_modules/.bin/openspec');
const fallaExecutable = path.join(repo, 'bin/falla-openspec.js');
const secret = /PRIVATE_LEAD|PRIVATE_NEXT|PRIVATE_WORKER|PRIVATE_HANDOFF/;
const parentTasks = '<!-- falla-tasks-format: 1 -->\n## 1. 协调验收\n- [ ] 1.1 汇总子交付（依赖：无）\n- [ ] 1.2 [人工] 总体验收（依赖：1.1）\n';
const childTasks = '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 合成子交付（依赖：无）\n';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-parent-coordinator-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, PATH: `${path.dirname(officialExecutable)}${path.delimiter}${process.env.PATH}` };
  async function command(executable, args) {
    try {
      const output = await execute(executable, args, { cwd: root, env, timeout: 20000, maxBuffer: 512 * 1024 });
      return { code: 0, ...output, value: args.includes('--json') ? JSON.parse(output.stdout) : null };
    } catch (error) {
      if (typeof error.code !== 'number' || error.killed) throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr,
        value: args.includes('--json') && error.stdout.trim() ? JSON.parse(error.stdout) : null };
    }
  }
  const official = (...args) => command(officialExecutable, [...args, '--json']);
  const falla = (...args) => command(process.execPath, [fallaExecutable, 'coordination', ...args, '--json']);
  async function succeeds(promise) {
    const result = await promise;
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, secret);
    return result.value;
  }
  async function fails(promise) {
    const result = await promise;
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout + result.stderr, secret);
    return result;
  }
  assert.equal((await command(officialExecutable, ['init', '--tools', 'none', '.'])).code, 0);
  await cp(path.join(repo, 'templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  await succeeds(official('new', 'change', 'team', '--schema', 'falla-spec-driven'));
  const parent = path.join(root, 'openspec/changes/team');
  await writeFile(path.join(parent, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
  for (const [file, text] of Object.entries({
    'preflight.md': '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# 合成需求\n',
    'proposal.md': '# 范围\n协作说明调整，不修改业务行为。\n', 'design.md': '# 设计\n无业务代码改动。\n',
  })) await writeFile(path.join(parent, file), text);
  const mapping = await succeeds(falla('register', 'team/worker'));
  await succeeds(official('new', 'change', mapping.physical, '--schema', 'falla-task-driven'));
  const child = path.join(root, 'openspec/changes', mapping.physical);
  // 直接读取发布模板，仅填写执行/验证模式，不预填父子负责人、状态或基线。
  await writeFile(path.join(parent, 'comate.md'), (await readFile(path.join(repo,
    'templates/openspec/schemas/falla-spec-driven/templates/comate.md'), 'utf8')).replace('execution-mode): single', 'execution-mode): parallel'));
  await writeFile(path.join(child, 'comate.md'), (await readFile(path.join(repo,
    'templates/openspec/schemas/falla-task-driven/templates/comate.md'), 'utf8')).replace('human-review): pending', 'human-review): not-required'));
  await writeFile(path.join(parent, 'tasks.md'), parentTasks);
  await writeFile(path.join(child, 'tasks.md'), childTasks);
  const record = directory => readFile(path.join(directory, 'comate.md'), 'utf8');
  const save = (directory, text) => writeFile(path.join(directory, 'comate.md'), text);
  return { root, parent, child, physical: mapping.physical, official, falla, succeeds, fails, record, save };
}

function evidence(markdown) {
  return markdown.replace('  - 已完成：', '  - 已完成：当前任务验证通过')
    .replace('  - 注释审计：', '  - 注释审计：无代码改动，不适用')
    .replace('  - 验证证据：', '  - 验证证据：当前合成清单逐项核对')
    .replace('  - 安全与敏感信息结论：', '  - 安全与敏感信息结论：未输出原始正文')
    .replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：无已知遗留风险；变化后先暂停再复核');
}

test('真实 CLI 从默认父模板认领、暂停/交接、汇总验收到父子归档闭环', async t => {
  const p = await fixture(t);
  const parentBefore = await p.record(p.parent);
  const childBefore = await p.record(p.child);
  assert.equal(parseComate(parentBefore).owner, 'unassigned');
  assert.equal(parseComate(parentBefore).status, 'todo');
  const pending = await p.succeeds(p.falla('validate', '--change', 'team'));
  assert.deepEqual(pending.ready, []);
  assert.deepEqual(pending.blocked, ['team/worker']);
  await p.fails(p.falla('claim', 'team', '--owner', 'PRIVATE_LEAD'));
  await p.fails(p.falla('claim', 'team/worker', '--owner', 'PRIVATE_WORKER'));
  assert.equal(await p.record(p.parent), parentBefore);
  assert.equal(await p.record(p.child), childBefore);
  const claimed = await p.succeeds(p.falla('claim', 'team', '--coordinator', '--owner', 'PRIVATE_LEAD'));
  assert.equal(claimed.role, 'coordinator');
  assert.equal(await p.record(p.child), childBefore);
  await p.fails(p.falla('claim', 'team/worker', '--coordinator', '--owner', 'PRIVATE_LEAD'));
  await p.succeeds(p.falla('claim', 'team/worker', '--owner', 'PRIVATE_WORKER'));
  const runningChild = await p.record(p.child);
  await p.save(p.parent, (await p.record(p.parent))
    .replace('  - 下一步准确操作：', '  - 下一步准确操作：用户批准协调交接；PRIVATE_HANDOFF 仅保留本地')
    .replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：等待其他 owner 暂停活动记录，复核后恢复'));
  await p.succeeds(p.falla('transition', 'team', '--owner', 'PRIVATE_LEAD', '--status', 'blocked'));
  assert.equal(await p.record(p.child), runningChild);
  await p.fails(p.falla('claim', 'team/worker', '--owner', 'PRIVATE_WORKER'));
  const paused = await p.falla('validate', '--change', 'team');
  assert.equal(paused.code, 1);
  assert.ok(paused.value.errors.some(error => error.kind === 'parent-blocked'));
  await p.save(p.child, runningChild.replace('status): in-progress', 'status): blocked')
    .replace('  - 遗留风险与恢复条件：', '  - 遗留风险与恢复条件：等待父协调者恢复'));
  await p.succeeds(p.falla('validate', '--change', 'team'));
  await p.fails(p.falla('transfer', 'team', '--owner', 'PRIVATE_WORKER', '--to', 'PRIVATE_NEXT'));
  await p.succeeds(p.falla('transfer', 'team', '--owner', 'PRIVATE_LEAD', '--to', 'PRIVATE_NEXT'));
  await p.fails(p.falla('transition', 'team', '--owner', 'PRIVATE_LEAD', '--status', 'in-progress'));
  await p.succeeds(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'in-progress'));
  await p.save(p.child, (await p.record(p.child)).replace('status): blocked', 'status): in-progress'));
  await p.succeeds(p.falla('claim', 'team/worker', '--owner', 'PRIVATE_WORKER'));
  await p.fails(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'done'));
  await p.save(p.child, evidence(await p.record(p.child)).replace('status): in-progress', 'status): done'));
  await writeFile(path.join(p.child, 'tasks.md'), childTasks.replace('[ ]', '[x]'));
  await p.succeeds(p.falla('validate', '--change', 'team'));
  await p.fails(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'done'));
  await writeFile(path.join(p.parent, 'tasks.md'), parentTasks.replaceAll('[ ]', '[x]'));
  await p.save(p.parent, evidence(await p.record(p.parent)));
  const beforeHuman = await p.record(p.parent);
  await p.fails(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'done'));
  assert.equal(await p.record(p.parent), beforeHuman);
  await p.save(p.parent, beforeHuman.replace('human-review): pending', 'human-review): passed')
    .replace('  - 人工验证反馈：', '  - 人工验证反馈：用户明确确认当前合成里程碑通过'));
  await p.succeeds(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'done'));
  assert.equal(parseComate(await p.record(p.parent)).status, 'done');
  for (const [reference, physical, directory] of [
    ['team/worker', p.physical, p.child], ['team', 'team', p.parent],
  ]) {
    assert.equal((await p.official('validate', physical, '--strict', '--no-interactive')).code, 0);
    const admission = await p.succeeds(p.falla('preflight', reference));
    assert.equal(admission.parent, 'team');
    await p.succeeds(p.falla('validate', '--change', admission.parent));
    const archived = await p.official('archive', physical, '--yes');
    assert.equal(archived.code, 0, archived.stderr);
    await assert.rejects(access(directory));
    assert.equal((await p.succeeds(p.falla('resolve', reference))).lifecycle, 'archived');
  }
  await p.fails(p.falla('transition', 'team', '--owner', 'PRIVATE_NEXT', '--status', 'blocked'));
});
