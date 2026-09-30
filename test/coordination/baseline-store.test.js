import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { inspectBaseline } from '../../src/coordination/baseline-files.js';
import { recordBaseline } from '../../src/coordination/baseline-store.js';
import { readBaselineFields } from '../../src/coordination/baseline.js';
import { registerMapping } from '../../src/coordination/resolver.js';

const taskText = '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [ ] 1.1 文案（依赖：无）\n- [ ] 1.2 [人工] 视觉（依赖：1.1）\n';
const clear = '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\n---\n';
async function fixture(t, { status = 'todo', owner = 'unassigned', mode = 'single' } = {}) {
  const root = await mkdtemp('/private/tmp/falla-baseline-store-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'openspec/changes/page');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'preflight.md'), clear);
  await writeFile(path.join(dir, '.openspec.yaml'), 'schema: falla-spec-driven\nskip_specs: true\n');
  await writeFile(path.join(dir, 'proposal.md'), '# 合成范围\n');
  await writeFile(path.join(dir, 'design.md'), '# 设计\n旧文案\n');
  await writeFile(path.join(dir, 'tasks.md'), taskText);
  const markdown = `# comate\n- 格式版本 (format-version): 2\n- 执行模式 (execution-mode): ${mode}\n- 负责人 (owner): ${owner}\n- 状态 (status): ${status}\n- 验证模式 (validation-mode): hybrid\n- 人工验证状态 (human-review): pending\n- 依赖 (depends-on): []\n- 交接 (handoff):\n  - 验证证据：PRIVATE_EVIDENCE\n`;
  await writeFile(path.join(dir, 'comate.md'), markdown);
  const file = path.join(dir, 'comate.md');
  return { root, dir, file, markdown };
}

function withReview(markdown, before, current, extra = {}) {
  return `- 基线复核 (baseline-review): ${JSON.stringify({
    from: before?.fingerprint ?? null, to: current.fingerprint,
    affected: ['1.2'], preserved: ['1.1'], evidence: 'PRIVATE_REVIEW：仅视觉标准变化，文案证据仍适用', ...extra,
  })}\n${markdown.replace(/^- 基线复核 \(baseline-review\):.*\n/gmu, '')}`;
}

test('初始记录无进度时仅写基线，命令输出不带正文且再次记录幂等', async t => {
  const p = await fixture(t);
  const before = await inspectBaseline(p.root, 'page');
  assert.equal(before.ok, true);
  assert.equal(before.recorded, null);
  const result = await recordBaseline(p.root, 'page', { owner: 'alice' });
  assert.equal(result.recorded, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|文案|视觉/);
  const updated = await readFile(p.file, 'utf8');
  assert.equal(updated.replace(/^- 实施基线 \(baseline\):.*\n/mu, ''), p.markdown);
  assert.equal((await inspectBaseline(p.root, 'page')).ok, true);
  assert.equal((await recordBaseline(p.root, 'page', { owner: 'alice' })).recorded, false);
});

test('安全来源目录及 specs 增删可检出，链接/超限拒绝且不写记录', async t => {
  const p = await fixture(t);
  await recordBaseline(p.root, 'page', { owner: 'alice' });
  const before = await readFile(p.file, 'utf8');
  const specs = path.join(p.dir, 'specs/card');
  await mkdir(specs, { recursive: true });
  await writeFile(path.join(specs, 'spec.md'), '# 规格\n新要求\n');
  assert.ok((await inspectBaseline(p.root, 'page')).errors.some(e => e.kind === 'baseline-review-required'));
  await rm(path.join(p.dir, 'specs'), { recursive: true });
  assert.equal((await inspectBaseline(p.root, 'page')).ok, true);
  await rm(path.join(p.dir, 'design.md'));
  await symlink(path.join(p.dir, 'proposal.md'), path.join(p.dir, 'design.md'));
  assert.ok((await inspectBaseline(p.root, 'page')).errors.some(e => e.kind === 'baseline-unreadable'));
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /基线/);
  assert.equal(await readFile(p.file, 'utf8'), before);
  await rm(path.join(p.dir, 'design.md'));
  await writeFile(path.join(p.dir, 'design.md'), 'x'.repeat(256 * 1024 + 1));
  assert.equal((await inspectBaseline(p.root, 'page')).ok, false);
});

test('旧实施/已完成证据无基线不可自动更新；影响回退后显式复核保留不受影响任务', async t => {
  const p = await fixture(t, { status: 'in-progress', owner: 'alice' });
  await writeFile(path.join(p.dir, 'tasks.md'), taskText.replace('[ ] 1.1', '[x] 1.1'));
  const before = await readFile(p.file, 'utf8');
  assert.ok((await inspectBaseline(p.root, 'page')).errors.some(e => e.kind === 'baseline-unverified'));
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /复核/);
  assert.equal(await readFile(p.file, 'utf8'), before);
  const current = (await inspectBaseline(p.root, 'page')).current;
  await writeFile(p.file, withReview(before, null, current));
  assert.equal((await recordBaseline(p.root, 'page', { owner: 'alice' })).recorded, true);
  const stored = readBaselineFields(await readFile(p.file, 'utf8')).snapshot;
  await writeFile(path.join(p.dir, 'design.md'), '# 设计\n新视觉标准，文案保持不变\n');
  const newCurrent = (await inspectBaseline(p.root, 'page')).current;
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /复核/);
  await writeFile(p.file, withReview(await readFile(p.file, 'utf8'), stored, newCurrent));
  await recordBaseline(p.root, 'page', { owner: 'alice' });
  assert.ok((await readFile(path.join(p.dir, 'tasks.md'), 'utf8')).includes('[x] 1.1'));
  assert.equal((await inspectBaseline(p.root, 'page')).ok, true);
});

test('另一 owner、归档记录和未决父需求均拒绝记录，不改 owner 或归档', async t => {
  const p = await fixture(t, { owner: 'bob' });
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /owner|负责人/);
  assert.equal(await readFile(p.file, 'utf8'), p.markdown);
  await writeFile(path.join(p.dir, 'preflight.md'), clear.replace('reviewed: true', 'reviewed: false'));
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'bob' }), /Preflight/);
  await writeFile(path.join(p.dir, 'preflight.md'), clear);
  const archived = path.join(p.root, 'openspec/changes/archive/2026-09-30-page');
  await mkdir(path.dirname(archived));
  const { rename } = await import('node:fs/promises');
  await rename(p.dir, archived);
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'bob' }), /归档/);
  assert.equal(await readFile(path.join(archived, 'comate.md'), 'utf8'), p.markdown);
});

test('逻辑/物理子名均绑定父公共基线，子自己的设计/Preflight 不得替换父', async t => {
  const p = await fixture(t, { mode: 'parallel' });
  const mapping = await registerMapping(p.root, 'page/view');
  const child = path.join(p.root, 'openspec/changes', mapping.physical);
  await mkdir(child);
  await writeFile(path.join(child, 'tasks.md'), taskText);
  await writeFile(path.join(child, 'comate.md'), p.markdown.replace('- 执行模式 (execution-mode): parallel\n', ''));
  const initial = await inspectBaseline(p.root, 'page/view');
  assert.equal(initial.current.fingerprint, (await inspectBaseline(p.root, mapping.physical)).current.fingerprint);
  await writeFile(path.join(child, 'design.md'), '# PRIVATE_CHILD_OVERRIDE\n');
  await writeFile(path.join(child, 'preflight.md'), '# PRIVATE_CHILD_OVERRIDE\n');
  assert.equal(initial.current.fingerprint, (await inspectBaseline(p.root, 'page/view')).current.fingerprint);
  await writeFile(path.join(p.dir, 'design.md'), '# 新父设计\n');
  assert.notEqual(initial.current.fingerprint, (await inspectBaseline(p.root, 'page/view')).current.fingerprint);
});

test('基线字段显式 null 或来源 changedTask 已勾选不能被 record 静默抹掉', async t => {
  const p = await fixture(t);
  await writeFile(p.file, '- 实施基线 (baseline): null\n' + p.markdown);
  assert.equal((await inspectBaseline(p.root, 'page')).ok, false);
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /基线/);
});

test('复核 record 不接受已完成任务完成条件改变后仍列为 preserved', async t => {
  const p = await fixture(t);
  await recordBaseline(p.root, 'page', { owner: 'alice' });
  const original = await readFile(p.file, 'utf8');
  const snapshot = readBaselineFields(original).snapshot;
  await writeFile(path.join(p.dir, 'tasks.md'), taskText.replace('[ ] 1.1 文案', '[x] 1.1 新文案'));
  const active = original.replace('owner): unassigned', 'owner): alice').replace('status): todo', 'status): in-progress');
  await writeFile(p.file, withReview(active, snapshot, (await inspectBaseline(p.root, 'page')).current));
  const before = await readFile(p.file, 'utf8');
  await assert.rejects(() => recordBaseline(p.root, 'page', { owner: 'alice' }), /复核/);
  assert.equal(await readFile(p.file, 'utf8'), before);
});

test('并发记录采用同一锁，不遗留 lock/临时文件且原 owner 保持不变', async t => {
  const p = await fixture(t);
  const results = await Promise.allSettled([
    recordBaseline(p.root, 'page', { owner: 'alice' }), recordBaseline(p.root, 'page', { owner: 'bob' }),
  ]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.ok((await readFile(p.file, 'utf8')).includes('owner): unassigned'));
  const { readdir } = await import('node:fs/promises');
  assert.ok(!(await readdir(path.join(p.root, '.falla'))).includes('coordination.lock'));
  assert.ok(!(await readdir(p.dir)).some(file => file.endsWith('.tmp')));
});

test('父 tasks 的真实进度不会使子基线失效，但父代码中的字面 checkbox 变化须可检出', async t => {
  const p = await fixture(t, { mode: 'parallel' });
  const mapping = await registerMapping(p.root, 'page/view');
  const child = path.join(p.root, 'openspec/changes', mapping.physical);
  await mkdir(child);
  await writeFile(path.join(child, 'tasks.md'), taskText);
  await writeFile(path.join(child, 'comate.md'), p.markdown.replace('- 执行模式 (execution-mode): parallel\n', ''));
  const parentTasks = '- [ ] 1.1 文案\n\n```text\n- [x] 精确输出\n```\n';
  await writeFile(path.join(p.dir, 'tasks.md'), parentTasks);
  const before = (await inspectBaseline(p.root, 'page/view')).current.fingerprint;
  await writeFile(path.join(p.dir, 'tasks.md'), parentTasks.replace('[ ] 1.1', '[x] 1.1'));
  assert.equal((await inspectBaseline(p.root, 'page/view')).current.fingerprint, before);
  await writeFile(path.join(p.dir, 'tasks.md'), parentTasks.replace('[x] 精确输出', '[ ] 精确输出'));
  assert.notEqual((await inspectBaseline(p.root, 'page/view')).current.fingerprint, before);
});
