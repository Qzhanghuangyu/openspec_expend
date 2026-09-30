import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { parseComate, parseTaskProgress } from '../../src/coordination/comate.js';

const execute = promisify(execFile);
const repo = process.cwd();
const officialExecutable = path.join(repo, 'node_modules/.bin/openspec');
const fallaExecutable = path.join(repo, 'bin/falla-openspec.js');
const definition = '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 合成任务（依赖：无）\n';

async function fixture(t, mode = 'single') {
  const root = await mkdtemp('/private/tmp/falla-archive-gates-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = { ...process.env, PATH: `${path.dirname(officialExecutable)}${path.delimiter}${process.env.PATH}` };
  async function command(executable, args) {
    try {
      const output = await execute(executable, args, { cwd: root, env: environment, timeout: 20000, maxBuffer: 512 * 1024 });
      return { code: 0, ...output, value: args.includes('--json') ? JSON.parse(output.stdout) : null };
    } catch (error) {
      if (typeof error.code !== 'number' || error.killed) throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr,
        value: args.includes('--json') && error.stdout.trim() ? JSON.parse(error.stdout) : null };
    }
  }
  const official = (...args) => command(officialExecutable, [...args, '--json']);
  const falla = (...args) => command(process.execPath, [fallaExecutable, ...args, '--json']);
  assert.equal((await command(officialExecutable, ['init', '--tools', 'none', '.'])).code, 0);
  await cp(path.join(repo, 'templates/openspec/schemas'), path.join(root, 'openspec/schemas'), { recursive: true });
  const files = new Map();
  async function create(reference) {
    const child = reference.includes('/');
    const physical = child ? (await falla('coordination', 'register', reference)).value.physical : reference;
    assert.equal((await official('new', 'change', physical, '--schema', child ? 'falla-task-driven' : 'falla-spec-driven')).code, 0);
    const directory = path.join(root, 'openspec/changes', physical);
    files.set(reference, { physical, directory });
    if (!child) {
      for (const [file, content] of Object.entries({
        '.openspec.yaml': 'schema: falla-spec-driven\nskip_specs: true\n',
        'preflight.md': '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n# 合成需求\n',
        'proposal.md': '# 范围\n内部说明调整。\n', 'design.md': '# 设计\n合成任务，无业务代码。\n',
      })) await writeFile(path.join(directory, file), content);
    }
    await writeFile(path.join(directory, 'tasks.md'), definition);
    await writeFile(path.join(directory, 'comate.md'), `# comate
- 格式版本 (format-version): 2
${child ? '' : `- 执行模式 (execution-mode): ${mode}\n`}- 负责人 (owner): unassigned
- 状态 (status): todo
- 验证模式 (validation-mode): hybrid
- 人工验证状态 (human-review): not-required
- 依赖 (depends-on): []
- 交接 (handoff):
  - 已完成：合成任务
  - 注释审计：无业务代码修改
  - 验证证据：合成验证证据
  - 人工验证反馈：合成人工已明确确认
  - 安全与敏感信息结论：仅合成数据
  - 遗留风险与恢复条件：仅验证归档流程
`);
    assert.equal((await falla('coordination', 'baseline', reference, '--record', '--owner', 'alice')).code, 0);
    return { physical, directory };
  }
  async function complete(reference) {
    const { directory } = files.get(reference);
    await writeFile(path.join(directory, 'tasks.md'), definition.replace('[ ]', '[x]'));
    const file = path.join(directory, 'comate.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('owner): unassigned', 'owner): alice').replace('status): todo', 'status): done'));
  }
  const parent = await create('page');
  const child = mode === 'parallel' ? await create('page/view') : null;
  if (child) await complete('page/view');
  await complete('page');
  return { root, files, official, falla, parent, child };
}

// 此 test-only 编排读取 Skill 实际发布的命令；不新增产品归档命令，也不证明 Agent 必然遵守规则。
async function publishedGate(p, reference) {
  const skill = await readFile(path.join(repo, 'templates/skills/falla-archive-change/SKILL.md'), 'utf8');
  const preflightCommand = skill.match(/^\s*(falla-openspec coordination preflight "<change>" --json)\s*$/mu)?.[1];
  const validateCommand = skill.match(/^\s*(falla-openspec coordination validate --change "<parent>" --json)\s*$/mu)?.[1];
  assert.ok(preflightCommand, '归档 Skill 必须发布所有目标的父引用与准入检查');
  assert.ok(validateCommand, '归档 Skill 必须发布对应父 DAG 校验');
  const preflight = await p.falla(...preflightCommand.replace('"<change>"', reference).split(' ').slice(1, -1));
  if (preflight.code !== 0 || preflight.value?.ok !== true) return { ok: false, stage: 'preflight', ...preflight };
  const parent = preflight.value.parent;
  const validation = await p.falla(...validateCommand.replace('"<parent>"', parent).split(' ').slice(1, -1));
  return { ...validation, ok: validation.code === 0 && validation.value?.ok === true, parent, stage: 'coordination' };
}

async function archiveAfterGate(p, reference, physical, { acceptIncomplete = false } = {}) {
  const gate = await publishedGate(p, reference);
  if (!gate.ok) return { attempted: false, gate };
  const instructions = await p.official('instructions', 'archive', '--change', physical);
  assert.equal(instructions.code, 0);
  // archive instructions 不承诺 taskProgress；任务与协作文件才是当前进度事实源。
  const resolved = await p.falla('coordination', 'resolve', reference);
  assert.equal(resolved.code, 0);
  assert.equal(resolved.value.physical, physical);
  const directory = path.join(p.root, resolved.value.path);
  const progress = parseTaskProgress(await readFile(path.join(directory, 'tasks.md'), 'utf8'));
  const record = parseComate(await readFile(path.join(directory, 'comate.md'), 'utf8'));
  const incomplete = progress.pending > 0 || record.status !== 'done'
    || ['pending', 'failed'].includes(record.humanReview);
  if (incomplete && !acceptIncomplete) return { attempted: false, gate, warning: 'incomplete' };
  const result = await p.official('archive', physical, '--yes');
  return { attempted: true, gate, result };
}

const targets = [
  { name: 'single', mode: 'single', reference: p => 'page', record: p => p.parent },
  { name: 'parallel 父', mode: 'parallel', reference: p => 'page', record: p => p.parent },
  { name: 'parallel 逻辑子', mode: 'parallel', reference: p => 'page/view', record: p => p.child },
  { name: 'parallel 物理子', mode: 'parallel', reference: p => p.child.physical, record: p => p.child },
];

for (const target of targets) {
  test(`${target.name} 归档流程拒绝依赖错误、人工结果缺失及 done 状态冲突，不移动目录`, async t => {
    const p = await fixture(t, target.mode);
    const reference = target.reference(p);
    const record = target.record(p);
    const tasksFile = path.join(record.directory, 'tasks.md');
    const comateFile = path.join(record.directory, 'comate.md');
    const beforeTasks = await readFile(tasksFile, 'utf8');
    const beforeComate = await readFile(comateFile, 'utf8');
    assert.equal((await p.official('validate', record.physical, '--strict', '--no-interactive')).code, 0);
    assert.equal((await publishedGate(p, reference)).ok, true);
    for (const [tasks, comate, kind] of [
      [beforeTasks.replace('依赖：无', '依赖：9.9'), beforeComate, 'task-dependency-missing'],
      [beforeTasks.replace('1.1 合成任务', '1.1 [人工] 合成任务'),
        beforeComate.replace('human-review): not-required', 'human-review): passed'), 'human-task-result-required'],
      [beforeTasks.replace('[x]', '[ ]'), beforeComate, 'tasks-incomplete'],
    ]) {
      await writeFile(tasksFile, tasks);
      await writeFile(comateFile, comate);
      const result = await archiveAfterGate(p, reference, record.physical, { acceptIncomplete: true });
      assert.equal(result.attempted, false, kind);
      assert.equal(result.gate.code, 1);
      assert.ok(result.gate.value.errors.some(error => error.kind === kind), kind);
      assert.equal(await readFile(tasksFile, 'utf8'), tasks);
      assert.equal(await readFile(comateFile, 'utf8'), comate);
      await access(record.directory);
      await writeFile(tasksFile, beforeTasks);
      await writeFile(comateFile, beforeComate);
    }
    assert.equal((await publishedGate(p, reference)).ok, true);
  });
}

test('逻辑及物理子都核对父 DAG，父子状态/基线冲突不可用子记录绕过', async t => {
  const p = await fixture(t, 'parallel');
  const file = path.join(p.child.directory, 'comate.md');
  const completed = await readFile(file, 'utf8');
  await writeFile(file, completed.replace('status): done', 'status): in-progress'));
  for (const reference of ['page/view', p.child.physical]) {
    const gate = await publishedGate(p, reference);
    assert.equal(gate.parent, 'page');
    assert.equal(gate.ok, false);
    assert.ok(gate.value.errors.some(error => error.kind === 'child-not-done'));
  }
  await writeFile(file, completed);
  await writeFile(path.join(p.parent.directory, 'design.md'), '# PRIVATE_REVISED_PARENT_DESIGN\n');
  for (const reference of ['page/view', p.child.physical]) {
    const gate = await publishedGate(p, reference);
    assert.equal(gate.ok, false);
    assert.ok(gate.value.errors.some(error => error.kind === 'baseline-review-required'));
    assert.doesNotMatch(gate.stdout + gate.stderr, /PRIVATE_REVISED_PARENT_DESIGN/u);
  }
});

test('合法 parallel 先归档子再重验父，归档保留映射、基线及协作记录', async t => {
  const p = await fixture(t, 'parallel');
  const mappingFile = path.join(p.root, '.falla/coordination.yaml');
  const mapping = await readFile(mappingFile, 'utf8');
  const childRecord = await readFile(path.join(p.child.directory, 'comate.md'), 'utf8');
  const child = await archiveAfterGate(p, p.child.physical, p.child.physical);
  assert.equal(child.result.code, 0);
  assert.equal(child.gate.parent, 'page');
  assert.equal(await readFile(path.join(child.result.value.archive.path, 'comate.md'), 'utf8'), childRecord);
  const parentRecord = await readFile(path.join(p.parent.directory, 'comate.md'), 'utf8');
  const parent = await archiveAfterGate(p, 'page', p.parent.physical);
  assert.equal(parent.result.code, 0);
  assert.equal(await readFile(path.join(parent.result.value.archive.path, 'comate.md'), 'utf8'), parentRecord);
  assert.equal(await readFile(mappingFile, 'utf8'), mapping);
});

test('明确接受未完成告警时保留真实 in-progress/pending 和 checkbox，不伪造 done 或 passed', async t => {
  const p = await fixture(t);
  const file = path.join(p.parent.directory, 'comate.md');
  const tasksFile = path.join(p.parent.directory, 'tasks.md');
  await writeFile(tasksFile, definition);
  const partial = (await readFile(file, 'utf8')).replace('status): done', 'status): in-progress')
    .replace('human-review): not-required', 'human-review): pending');
  await writeFile(file, partial);
  assert.equal((await publishedGate(p, 'page')).ok, true);
  const notAccepted = await archiveAfterGate(p, 'page', p.parent.physical);
  assert.equal(notAccepted.attempted, false, '门禁通过不等于用户接受未完成告警');
  await access(p.parent.directory);
  assert.equal(await readFile(file, 'utf8'), partial);
  const result = await archiveAfterGate(p, 'page', p.parent.physical, { acceptIncomplete: true });
  assert.equal(result.result.code, 0);
  const archive = result.result.value.archive.path;
  assert.equal(await readFile(path.join(archive, 'tasks.md'), 'utf8'), definition);
  assert.equal(await readFile(path.join(archive, 'comate.md'), 'utf8'), partial);
});

test('等待用户确认后基线改变必须重新校验，不沿用此前通过结果归档', async t => {
  const p = await fixture(t);
  const file = path.join(p.parent.directory, 'comate.md');
  const tasksFile = path.join(p.parent.directory, 'tasks.md');
  await writeFile(tasksFile, definition);
  const partial = (await readFile(file, 'utf8')).replace('status): done', 'status): in-progress');
  await writeFile(file, partial);
  const waiting = await archiveAfterGate(p, 'page', p.parent.physical);
  assert.equal(waiting.attempted, false);
  assert.equal(waiting.gate.ok, true);
  assert.equal(waiting.warning, 'incomplete');
  // 等待期间发生真实文件修订；后续确认只接受未完成告警，不批准已改变的实施基线。
  await writeFile(path.join(p.parent.directory, 'design.md'), '# PRIVATE_CHANGED_DURING_CONFIRMATION\n');
  const resumed = await archiveAfterGate(p, 'page', p.parent.physical, { acceptIncomplete: true });
  assert.equal(resumed.attempted, false);
  assert.equal(resumed.gate.ok, false);
  assert.ok(resumed.gate.value.errors.some(error => error.kind === 'baseline-review-required'));
  assert.doesNotMatch(resumed.gate.stdout + resumed.gate.stderr, /PRIVATE_CHANGED_DURING_CONFIRMATION/u);
  assert.equal(await readFile(file, 'utf8'), partial);
  assert.equal(await readFile(tasksFile, 'utf8'), definition);
  await access(p.parent.directory);
});
