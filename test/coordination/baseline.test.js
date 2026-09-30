import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  createBaselineSnapshot, readBaselineFields, writeBaselineField,
  baselineTaskState, validateBaselineReview, baselineIssues,
} from '../../src/coordination/baseline.js';

const tasks = '<!-- falla-tasks-format: 1 -->\n## 1. 实施\n- [x] 1.1 文案（依赖：无）\n  - 完成条件：显示旧文案\n- [ ] 1.2 [人工] 视觉验收（依赖：1.1）\n';
const source = { design: '# 设计\n显示旧文案\n', coordination: '{"mode":"single"}' };
const record = { status: 'in-progress', owner: 'alice', humanReview: 'pending' };
const comate = '# comate\n- 负责人 (owner): alice\n- 状态 (status): in-progress\n- 交接 (handoff):\n  - 验证证据：PRIVATE_EVIDENCE\n';
const reviewFor = (before, after, extra = {}) => ({
  from: before?.fingerprint ?? null, to: after.fingerprint,
  affected: ['1.2'], preserved: ['1.1'], evidence: '已核对影响范围；保留旧文案验证结果', ...extra,
});

test('来源、任务完成条件或协作契约改变均改变指纹，不保存源正文', () => {
  const initial = createBaselineSnapshot(source, tasks);
  for (const [sources, definition] of [
    [{ ...source, design: '# 新设计\nPRIVATE_NEW_BEHAVIOR\n' }, tasks],
    [source, tasks.replace('显示旧文案', '显示新文案')],
    [{ ...source, coordination: '{"mode":"parallel"}' }, tasks],
    [{ ...source, specs: '# 新规格\n' }, tasks],
  ]) assert.notEqual(createBaselineSnapshot(sources, definition).fingerprint, initial.fingerprint);
  assert.doesNotMatch(JSON.stringify(initial), /文案|PRIVATE|设计|完成条件/);
  assert.equal(initial.version, 1);
});

test('checkbox 更新及普通空行/BOM/CRLF/行尾空白不影响指纹，代码块空白保持敏感', () => {
  const initial = createBaselineSnapshot(source, tasks);
  assert.equal(createBaselineSnapshot(source, tasks.replace('[x]', '[ ]')).fingerprint, initial.fingerprint);
  const formatted = '\uFEFF' + source.design.replaceAll('\n', '\t\r\n\r\n');
  assert.equal(createBaselineSnapshot({ ...source, design: formatted }, tasks + '\n').fingerprint, initial.fingerprint);
  const code = { design: '# 设计\n```text\nvalue  \n```\n' };
  assert.notEqual(createBaselineSnapshot(code, tasks).fingerprint,
    createBaselineSnapshot({ design: code.design.replace('value  ', 'value ') }, tasks).fingerprint);
});

test('基线字段往返只修改快照，不动 owner、状态、checkbox 或 handoff', () => {
  const initial = createBaselineSnapshot(source, tasks);
  const updated = writeBaselineField(comate, initial);
  assert.deepEqual(readBaselineFields(updated), { snapshot: initial, review: null });
  assert.equal(updated.replace(/^- 实施基线 \(baseline\):.*\n/mu, ''), comate);
  assert.deepEqual(readBaselineFields(comate), { snapshot: null, review: null });
  assert.deepEqual(readBaselineFields('- 实施基线 (baseline): unrecorded\n- 基线复核 (baseline-review): none\n'), { snapshot: null, review: null });
  assert.equal(writeBaselineField(updated, initial), updated);
});

test('非法 JSON、伪造指纹、重复字段及超预算拒绝且诊断不带正文', () => {
  const initial = createBaselineSnapshot(source, tasks);
  const fake = { ...initial, fingerprint: '0'.repeat(64) };
  for (const input of [
    '- 实施基线 (baseline): PRIVATE_NOT_JSON\n',
    `- 实施基线 (baseline): ${JSON.stringify(fake)}\n`,
    writeBaselineField(comate, initial) + '- 实施基线 (baseline): unrecorded\n',
    '- 基线复核 (baseline-review): {"evidence":"PRIVATE_BODY"}\n',
  ]) assert.throws(() => readBaselineFields(input), error => error.kind === 'baseline-invalid' && !/PRIVATE/.test(error.message));
  assert.throws(() => createBaselineSnapshot({ design: 'x'.repeat(256 * 1024 + 1) }, tasks), /基线/);
});

test('变化先要求复核，不清除进度；旧有证据无快照未核验，纯 todo 可以初始化', () => {
  const initial = createBaselineSnapshot(source, tasks);
  const changed = createBaselineSnapshot({ ...source, design: '# 改变验收\n' }, tasks);
  assert.deepEqual(baselineIssues(initial, changed, record, { complete: 1 }), [{ kind: 'baseline-review-required' }]);
  assert.deepEqual(baselineIssues(null, changed, record, { complete: 0 }), [{ kind: 'baseline-unverified' }]);
  assert.deepEqual(baselineIssues(null, changed, { status: 'todo', humanReview: 'not-required' }, { complete: 0 }), []);
  assert.deepEqual(baselineIssues(null, changed, { status: 'todo', humanReview: 'passed' }, { complete: 0 }), [{ kind: 'baseline-unverified' }]);
  assert.deepEqual(baselineIssues(initial, initial, record, { complete: 1 }), []);
});

test('显式复核可保留内容未改的已完成任务，影响项须先回退且完备划分范围', () => {
  const initial = createBaselineSnapshot(source, tasks);
  const changed = createBaselineSnapshot({ ...source, design: '# 视觉标准改变\n' }, tasks);
  const state = baselineTaskState(tasks);
  assert.deepEqual(validateBaselineReview(initial, changed, reviewFor(initial, changed), state, record), []);
  for (const review of [
    reviewFor(initial, changed, { from: '0'.repeat(64) }),
    reviewFor(initial, changed, { to: '0'.repeat(64) }),
    reviewFor(initial, changed, { evidence: '  ' }),
    reviewFor(initial, changed, { affected: [], preserved: ['1.1'] }),
    reviewFor(initial, changed, { affected: ['1.1', '1.2'], preserved: [] }),
    reviewFor(initial, changed, { affected: ['1.2'], preserved: ['1.1', 'PRIVATE_ID'] }),
  ]) assert.ok(validateBaselineReview(initial, changed, review, state, record).length > 0);
  assert.ok(validateBaselineReview(initial, changed, reviewFor(initial, changed), state,
    { ...record, status: 'done' }).length > 0);
  assert.ok(validateBaselineReview(initial, changed, reviewFor(initial, changed), state,
    { ...record, humanReview: 'passed' }).length > 0);
  const reworded = tasks.replace('显示旧文案', '显示新文案');
  const newTask = createBaselineSnapshot(source, reworded);
  assert.ok(validateBaselineReview(initial, newTask, reviewFor(initial, newTask), baselineTaskState(reworded), record)
    .some(error => error.kind === 'baseline-task-changed' && error.task === '1.1'));
});

test('显式 null 不是缺失记录；复核只接受定义的字段，不保存额外正文键', () => {
  const snapshot = createBaselineSnapshot(source, tasks);
  const review = reviewFor(snapshot, snapshot, { PRIVATE_EXTRA_BODY: 'PRIVATE_SECRET' });
  for (const input of [
    '- 实施基线 (baseline): null\n', '- 基线复核 (baseline-review): null\n',
    `- 基线复核 (baseline-review): ${JSON.stringify(review)}\n`,
  ]) assert.throws(() => readBaselineFields(input), /基线/);
});

test('副本预处理不能吞掉缩进代码、Markdown 硬换行或 YAML 字面量的实质变更', () => {
  for (const [before, after] of [
    ['# 示例\n\n    value  \n', '# 示例\n\n    value \n'],
    ['# 文案\n第一行  \n第二行\n', '# 文案\n第一行\n第二行\n'],
    ['---\nfalla-preflight: 1\nreviewed: true\nblockers: []\nnote: |\n  第一行\n\n  第二行\n---\n',
      '---\nfalla-preflight: 1\nreviewed: true\nblockers: []\nnote: |\n  第一行\n  第二行\n---\n'],
  ]) assert.notEqual(createBaselineSnapshot({ design: before }, tasks).fingerprint,
    createBaselineSnapshot({ design: after }, tasks).fingerprint);
});

test('嵌套子任务结束后恢复父任务的完成条件，父条件改变不可 preserved', () => {
  const nested = '- [x] 1.1 父任务\n  - [ ] 1.2 子任务\n  - 完成条件：旧父条件\n';
  const modified = nested.replace('旧父条件', '新父条件');
  const previous = createBaselineSnapshot(source, nested);
  const current = createBaselineSnapshot(source, modified);
  assert.notEqual(previous.tasks['1.1'], current.tasks['1.1']);
  assert.ok(validateBaselineReview(previous, current, reviewFor(previous, current),
    baselineTaskState(modified), { ...record, humanReview: 'not-required' })
    .some(error => error.kind === 'baseline-task-changed' && error.task === '1.1'));
});

test('围栏中的旧字面 checkbox 内容变化不归一化，旧匿名勾选仍算已有证据', () => {
  const old = '- [ ] 1.1 输出定义\n\n```text\n- [x] 精确输出\n```\n';
  const modified = old.replace('[x] 精确输出', '[ ] 精确输出');
  assert.notEqual(createBaselineSnapshot(source, old).fingerprint, createBaselineSnapshot(source, modified).fingerprint);
  const state = baselineTaskState('```text\n- [x] 旧匿名任务\n```\n');
  assert.equal(state.complete, 1);
  assert.equal(state.anonymous, 1);
  assert.deepEqual(baselineIssues(null, createBaselineSnapshot(source, ''), { status: 'todo' }, state),
    [{ kind: 'baseline-unverified' }]);
});

test('BOM 不得隐藏既有基线或复核字段，来源 tasks 保留键明确拒绝', () => {
  const initial = createBaselineSnapshot(source, tasks);
  const serialized = writeBaselineField('# comate\n', initial);
  assert.deepEqual(readBaselineFields('\uFEFF' + serialized).snapshot, initial);
  assert.throws(() => createBaselineSnapshot({ tasks: 'PRIVATE_PARENT_TASKS' }, tasks), /基线/);
});

test('affected 包含人工验收时 passed 不得继续有效，旧匿名任务需显式编号后再复核', () => {
  const previous = createBaselineSnapshot(source, tasks);
  const current = createBaselineSnapshot({ ...source, design: '# 新视觉标准\n' }, tasks);
  const review = reviewFor(previous, current);
  assert.ok(validateBaselineReview(previous, current, review, baselineTaskState(tasks),
    { ...record, humanReview: 'passed' }).some(error => error.kind === 'baseline-human-review-required'));
  const anonymous = baselineTaskState('- [x] 未编号旧任务\n');
  assert.deepEqual(validateBaselineReview(null, createBaselineSnapshot(source, '- [x] 未编号旧任务\n'),
    { from: null, to: createBaselineSnapshot(source, '- [x] 未编号旧任务\n').fingerprint,
      affected: [], preserved: [], evidence: '旧证据尚未逐任务核实' }, anonymous, record), [{ kind: 'baseline-review-invalid' }]);
});

test('human 模式即使无显式人工任务，影响范围非空也须退回 pending', () => {
  const text = '- [ ] 1.1 更新\n';
  const previous = createBaselineSnapshot(source, text);
  const current = createBaselineSnapshot({ ...source, design: '# 新完成条件\n' }, text);
  const review = { from: previous.fingerprint, to: current.fingerprint, affected: ['1.1'], preserved: [], evidence: '完成条件改变，需人工复验' };
  const state = baselineTaskState(text);
  assert.ok(validateBaselineReview(previous, current, review, state,
    { status: 'in-progress', validationMode: 'human', humanReview: 'passed' })
    .some(error => error.kind === 'baseline-human-review-required'));
  assert.deepEqual(validateBaselineReview(previous, current, review, state,
    { status: 'in-progress', validationMode: 'human', humanReview: 'pending' }), []);
});

test('快照来源只允许固定名称，不把用户构造的来源键带入输出', () => {
  assert.throws(() => createBaselineSnapshot({ privateBody: 'PRIVATE_TEXT' }, tasks), /基线/);
  const snapshot = createBaselineSnapshot(source, tasks);
  const malicious = { version: 1, sources: { ...snapshot.sources, privateBody: 'a'.repeat(64) }, tasks: snapshot.tasks };
  const serialized = { ...malicious, fingerprint: createHash('sha256').update(JSON.stringify(malicious)).digest('hex') };
  assert.throws(() => readBaselineFields(`- 实施基线 (baseline): ${JSON.stringify(serialized)}\n`), /基线/);
});
