import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { coordinationCommand } from '../../src/commands/coordination.js';
import { validateChangeRecords } from '../../src/coordination/health.js';
import { main } from '../../src/cli.js';

const exec = promisify(execFile);
const clear = '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# Preflight\n已核对，无阻塞项。\n';
const pending = `---
falla-preflight: 1
reviewed: true
blockers:
  - id: B1
    scope: PRIVATE_SCOPE
    status: pending
    decision: ''
    evidence: ''
---
# Preflight
默认选中项尚未确认。
`;

async function project(t, mode = 'single') {
  const root = await mkdtemp('/private/tmp/falla-preflight-gate-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const io = { cwd: root, env: process.env, stdout: { write() {} }, stderr: { write() {} } };
  const command = (...args) => coordinationCommand([...args, '--json'], io);
  const official = async (...args) => JSON.parse((await exec('openspec', [...args, '--json'], { cwd: root })).stdout);
  await exec('openspec', ['init', '--tools', 'none', '.'], { cwd: root });
  await cp(path.resolve('templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  async function create(reference, dependencies = []) {
    const child = reference.includes('/');
    const physical = child ? (await command('register', reference)).physical : reference;
    await official('new', 'change', physical, '--schema', child ? 'falla-task-driven' : 'falla-spec-driven');
    const dir = path.join(root, 'openspec/changes', physical);
    if (!child) {
      await writeFile(path.join(dir, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
      for (const name of ['proposal', 'design']) await writeFile(path.join(dir, `${name}.md`), '# 内部调整\n');
      await writeFile(path.join(dir, 'preflight.md'), clear);
    }
    await writeFile(path.join(dir, 'tasks.md'), '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 更新（依赖：无）\n');
    await writeFile(path.join(dir, 'comate.md'), `# comate
- 格式版本 (format-version): 2
${child ? '' : `- 执行模式 (execution-mode): ${mode}\n`}- 负责人 (owner): unassigned
- 状态 (status): todo
- 验证模式 (validation-mode): hybrid
- 人工验证状态 (human-review): not-required
- 依赖 (depends-on): [${dependencies.join(', ')}]
- 交接 (handoff):
`);
    return { dir, physical };
  }
  const parent = await create('page');
  const preflight = path.join(parent.dir, 'preflight.md');
  return { root, io, command, official, create, preflight, parent,
    health: async () => validateChangeRecords(root, (await official('status', '--all')).changes),
  };
}

test('官方 ready 不能覆盖未解决 Blocker；拒绝不修改文件，同 owner 重试也复核', async t => {
  const p = await project(t);
  await writeFile(p.preflight, pending);
  assert.equal((await p.official('instructions', 'apply', '--change', 'page')).state, 'ready');
  const file = path.join(p.parent.dir, 'comate.md');
  const before = await readFile(file, 'utf8');
  await assert.rejects(() => p.command('claim', 'page', '--owner', 'alice'), /阻塞|preflight|验证/);
  assert.equal(await readFile(file, 'utf8'), before);
  for (const result of [await p.command('validate', '--change', 'page'), await p.health()]) {
    assert.ok(result.errors.some(e => e.kind === 'preflight-blocker-unresolved'));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SCOPE|默认选中/);
  }
  const confirmed = pending.replace('status: pending', 'status: confirmed')
    .replace("decision: ''", 'decision: 默认不选中').replace("evidence: ''", 'evidence: 用户本轮明确确认不选中');
  await writeFile(p.preflight, confirmed);
  assert.equal((await p.command('claim', 'page', '--owner', 'alice')).claimed, true);
  await writeFile(p.preflight, pending);
  const claimed = await readFile(file, 'utf8');
  await assert.rejects(() => p.command('claim', 'page', '--owner', 'alice'), /阻塞|preflight|验证/);
  assert.equal(await readFile(file, 'utf8'), claimed);
});

test('旧记录、未核对模板、非法或无依据确认均不放行；明确排除可放行', async t => {
  const p = await project(t);
  const invalid = [
    '# Preflight\nBlocker: 0\n', clear.replace('reviewed: true', 'reviewed: false'),
    clear.replace('blockers: []', 'blockers: null'),
    clear.replace('reviewed: true', 'reviewed: true\nreviewed: true'),
    pending.replace('status: pending', 'status: confirmed'),
    pending.replace('status: pending', 'status: excluded'),
    pending.replace('scope: PRIVATE_SCOPE', "scope: ''"),
    pending.replace('status: pending', 'status: invented'),
    clear.replace('falla-preflight: 1', 'falla-preflight: 999'),
  ];
  for (const content of invalid) {
    await writeFile(p.preflight, content);
    const result = await p.command('validate', '--change', 'page');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.kind.startsWith('preflight-')));
  }
  await writeFile(p.preflight, '# Preflight\nBlocker: 0\n');
  const before = await readFile(path.join(p.parent.dir, 'comate.md'), 'utf8');
  await assert.rejects(() => p.command('claim', 'page', '--owner', 'alice'), /preflight/);
  assert.equal(await readFile(path.join(p.parent.dir, 'comate.md'), 'utf8'), before);
  const excluded = pending.replace('status: pending', 'status: excluded')
    .replace("decision: ''", 'decision: 默认选中逻辑明确排除本次范围')
    .replace("evidence: ''", 'evidence: 用户确认仅调整文案');
  await writeFile(p.preflight, excluded);
  assert.equal((await p.command('validate', '--change', 'page')).ok, true);
  await writeFile(p.preflight, clear);
  assert.equal((await p.command('claim', 'page', '--owner', 'alice')).claimed, true);
});

test('子任务只使用父 preflight，不能以子文件或物理名绕过阻塞', async t => {
  const p = await project(t, 'parallel');
  const child = await p.create('page/view');
  await writeFile(p.preflight, pending);
  await writeFile(path.join(child.dir, 'preflight.md'), clear);
  const before = await readFile(path.join(child.dir, 'comate.md'), 'utf8');
  await assert.rejects(() => p.command('claim', 'page/view', '--owner', 'alice'), /阻塞|preflight|验证/);
  assert.equal(await readFile(path.join(child.dir, 'comate.md'), 'utf8'), before);
  for (const ref of ['page/view', child.physical]) {
    assert.equal((await p.command('preflight', ref)).ok, false);
  }
  await writeFile(p.preflight, clear);
  assert.equal((await p.command('claim', 'page/view', '--owner', 'alice')).claimed, true);
});

test('Propose 在只有 preflight 时即可只读校验，错误返回非零；缺失和符号链接不可放行', async t => {
  const p = await project(t);
  await p.official('new', 'change', 'planning', '--schema', 'falla-spec-driven');
  const file = path.join(p.root, 'openspec/changes/planning/preflight.md');
  await writeFile(file, pending);
  assert.equal(await main(['coordination', 'preflight', 'planning', '--json'], p.io), 1);
  await writeFile(file, clear);
  assert.equal(await main(['coordination', 'preflight', 'planning', '--json'], p.io), 0);
  await unlink(file);
  assert.equal((await p.command('preflight', 'planning')).ok, false);
  await symlink(p.preflight, file);
  assert.equal((await p.command('preflight', 'planning')).ok, false);
  assert.equal(await readFile(p.preflight, 'utf8'), clear);
});

test('跨父依赖的未核验旧归档不充当已确认需求，校验不改写归档', async t => {
  const p = await project(t);
  const upstream = await p.create('foundation');
  await writeFile(path.join(upstream.dir, 'tasks.md'), '- [x] 1.1 已完成\n');
  const file = path.join(upstream.dir, 'comate.md');
  const record = (await readFile(file, 'utf8')).replace('owner): unassigned', 'owner): alice')
    .replace('status): todo', 'status): done') + `  - 已完成：既有任务
  - 注释审计：不适用
  - 验证证据：既有验证
  - 安全与敏感信息结论：仅测试数据
  - 遗留风险与恢复条件：旧记录需重新核对
`;
  await writeFile(file, record);
  await writeFile(path.join(upstream.dir, 'preflight.md'), '# 旧 Preflight\n');
  const archive = await p.official('archive', 'foundation', '--yes');
  const target = path.join(p.parent.dir, 'comate.md');
  await writeFile(target, (await readFile(target, 'utf8')).replace('depends-on): []', 'depends-on): [foundation]'));
  const result = await p.command('validate', '--change', 'page');
  assert.ok(result.errors.some(e => e.kind === 'preflight-unverified' && e.change === 'foundation'));
  await assert.rejects(() => p.command('claim', 'page', '--owner', 'alice'), /preflight/);
  assert.equal(await readFile(path.join(archive.archive.path, 'preflight.md'), 'utf8'), '# 旧 Preflight\n');
});
