import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withHumanTaskResults } from '../helpers/human-results.js';

import {
  parseComate,
  parseTaskProgress,
  validateComateRecord,
} from '../../src/coordination/comate.js';

const valid = `# comate

- 负责人 (owner): alice
- 状态 (status): in-progress
- 依赖 (depends-on): [medal/view-model]
- 被依赖 (blocks): [medal/page-integration]
- 交接 (handoff): 已完成数据绑定，待视觉校准
`;

test('解析限定格式的 comate 字段', () => {
  assert.deepEqual(parseComate(valid, 'comate.md'), {
    owner: 'alice',
    status: 'in-progress',
    dependsOn: ['medal/view-model'],
    blocks: ['medal/page-integration'],
    handoff: '已完成数据绑定，待视觉校准',
  });
});

test('拒绝缺失、重复字段和未知状态', () => {
  assert.throws(
    () => parseComate(valid.replace('in-progress', 'started'), 'comate.md'),
    (error) => error.code === 1 && error.message.includes('status')
  );
  assert.throws(
    () => parseComate(`${valid}- 状态 (status): done\n`, 'comate.md'),
    (error) => error.code === 1 && error.message.includes('重复')
  );
  assert.throws(
    () => parseComate(valid.replace(/- 交接.*\n/, ''), 'comate.md'),
    (error) => error.code === 1 && error.message.includes('handoff')
  );
});

test('校验负责人、blocked 交接和 done 任务门禁', () => {
  assert.deepEqual(
    validateComateRecord({ ...parseComate(valid), owner: 'unassigned' }, { pendingTasks: 0 })
      .map(({ kind }) => kind),
    ['owner-required']
  );
  assert.deepEqual(
    validateComateRecord({ ...parseComate(valid), status: 'blocked', handoff: '' }, { pendingTasks: 0 })
      .map(({ kind }) => kind),
    ['blocked-handoff-required']
  );
  assert.deepEqual(
    validateComateRecord({ ...parseComate(valid), status: 'done' }, { pendingTasks: 1 })
      .map(({ kind }) => kind),
    ['tasks-incomplete']
  );
});

test('多行 handoff 读取到下一个顶级字段为止且空模板标签不算内容', () => {
  const emptyTemplate = valid.replace(
    '- 交接 (handoff): 已完成数据绑定，待视觉校准',
    `- 交接 (handoff):
  - 已完成：
  - 验证证据：
    - 命令：
    - 结果：
- 补充字段: 必须保留`
  );
  const empty = parseComate(emptyTemplate, 'comate.md');
  assert.match(empty.handoff, /验证证据/);
  assert.doesNotMatch(empty.handoff, /补充字段/);
  assert.deepEqual(
    validateComateRecord({ ...empty, status: 'done' }, { pendingTasks: 0 })
      .map(({ kind }) => kind),
    ['done-handoff-required']
  );

  const filled = parseComate(emptyTemplate.replace('命令：', '命令：npm test'), 'comate.md');
  assert.deepEqual(
    validateComateRecord({ ...filled, status: 'done' }, { pendingTasks: 0 }),
    []
  );
});

test('存在人工任务的 hybrid 与 human 模式必须由人工确认后才能 done', () => {
  const confirmedTask = { pendingTasks: 0, humanTasks: 1, taskStates: [{ id: '1.1', done: true, human: true }] };
  const human = withHumanTaskResults(valid.replace(
    '- 状态 (status): in-progress',
    `- 状态 (status): in-progress
- 验证模式 (validation-mode): human
- 人工验证状态 (human-review): pending`
  ), [['1.1', 'passed']]);
  assert.deepEqual(parseComate(human), {
    validationMode: 'human',
    humanReview: 'pending',
    humanTaskResults: [['1.1', 'passed']],
    owner: 'alice',
    status: 'in-progress',
    dependsOn: ['medal/view-model'],
    blocks: ['medal/page-integration'],
    handoff: '已完成数据绑定，待视觉校准',
  });
  assert.deepEqual(
    validateComateRecord({ ...parseComate(human), status: 'done' }, confirmedTask)
      .map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', validationMode: 'hybrid', humanReview: 'pending',
    }, confirmedTask).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', validationMode: 'hybrid', humanReview: 'not-required',
    }, confirmedTask).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', humanReview: 'passed',
    }, confirmedTask),
    []
  );
  assert.throws(
    () => parseComate(human.replace('human-review): pending', 'human-review): unknown')),
    /human-review/
  );
  assert.throws(
    () => parseComate(human.replace('validation-mode): human', 'validation-mode): agent')),
    /not-required/
  );
});

test('总 passed 和视觉反馈占位不能替代逐项人工结果', async () => {
  for (const schema of ['falla-spec-driven', 'falla-task-driven']) {
    const template = await readFile(`templates/openspec/schemas/${schema}/templates/comate.md`, 'utf8');
    const record = parseComate(template
      .replace('owner): unassigned', 'owner): alice')
      .replace('status): todo', 'status): done')
      .replace('human-review): pending', 'human-review): passed'));
    const issues = validateComateRecord(record, { pendingTasks: 0, humanTasks: 1,
      taskStates: [{ id: '1.1', done: true, human: true }] });
    assert.ok(issues.some(({ kind, task }) => kind === 'human-task-result-required' && task === '1.1'));
  }
});

test('hybrid 无人工任务可标记 not-required，有人工任务不能跳过人工验收', () => {
  const complete = parseComate(valid);
  const record = {
    ...complete,
    status: 'done',
    validationMode: 'hybrid',
    humanReview: 'not-required',
  };
  assert.deepEqual(validateComateRecord(record, { pendingTasks: 0, humanTasks: 0 }), []);
  assert.deepEqual(
    validateComateRecord({ ...record, humanTaskResults: [['1.1', 'passed']] }, { pendingTasks: 0, humanTasks: 1,
      taskStates: [{ id: '1.1', done: true, human: true }] }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord(record, { pendingTasks: 0 }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({ ...record, validationMode: 'human' }, {
      pendingTasks: 0, humanTasks: 0, taskStates: [],
    }).map(({ kind }) => kind),
    ['human-review-required']
  );
});

test('任务进度与 OpenSpec 1.12 一致统计嵌套、星号和宽松 checkbox', () => {
  assert.deepEqual(parseTaskProgress(`- [x] 1.1 done
  - [ ] 1.1.1 nested pending
* [X] 1.2 done
-[x] 1.3 compact done
- [\t] 1.4 tab pending
- item
`), {
    total: 5,
    complete: 3,
    pending: 2,
    humanTasks: 0,
    taskStates: [
      { id: '1.1', done: true, human: false },
      { id: '1.1.1', done: false, human: false },
      { id: '1.2', done: true, human: false },
      { id: '1.3', done: true, human: false },
      { id: '1.4', done: false, human: false },
    ],
    issues: [],
  });
  assert.equal(parseTaskProgress('- [x] 1.1 implement\n- [x] 2.1 [人工] verify\n').humanTasks, 1);
});

test('人工任务识别任务续行，重复标记只计一次，隔离相邻段落', () => {
  const progress = parseTaskProgress(`- [x] 1.1 完成实现
  需要 [人工] 验证，记录 [人工] 反馈
- [x] 1.2 完成联调
[人工] 独立续行说明
- [x] 1.3 自动检查
- 普通列表 [人工] 不属于任务
- [x] 1.4 自动检查

[人工] 独立段落不属于任务
- [x] 1.5 自动检查
## [人工] 下一章节不属于任务
`);
  assert.deepEqual(progress, { total: 5, complete: 5, pending: 0, humanTasks: 2, taskStates: [
    { id: '1.1', done: true, human: true }, { id: '1.2', done: true, human: true },
    { id: '1.3', done: true, human: false }, { id: '1.4', done: true, human: false },
    { id: '1.5', done: true, human: false },
  ], issues: [] });
});

test('agent 模式含人工任务立即冲突，hybrid 续行人工任务不得跳过验收', () => {
  const progress = parseTaskProgress('- [x] 1.1 校验\n  [人工] 设备反馈\n');
  const agent = { ...parseComate(valid), validationMode: 'agent', humanReview: 'not-required',
    humanTaskResults: [['1.1', 'passed']] };
  assert.deepEqual(
    validateComateRecord(agent, { pendingTasks: progress.pending, humanTasks: progress.humanTasks, taskStates: progress.taskStates })
      .map(({ kind }) => kind),
    ['validation-mode-conflict']
  );
  const hybrid = { ...agent, status: 'done', validationMode: 'hybrid' };
  assert.ok(validateComateRecord(hybrid, {
    pendingTasks: progress.pending, humanTasks: progress.humanTasks, taskStates: progress.taskStates,
  }).some(({ kind }) => kind === 'human-review-required'));
});

test('人工任务归属恢复外层任务，内部块不截断，独立块不污染任务', () => {
  assert.deepEqual(parseTaskProgress(`- [x] 1 外层
  - [x] 1.1 内层

  ### 外层的验收
  [人工] 外层仍需反馈
- [x] 2 自动验证

\`\`\`text
[人工] 独立示例
\`\`\`
## [人工] 独立章节
`), { total: 3, complete: 3, pending: 0, humanTasks: 1, taskStates: [
    { id: '1', done: true, human: true }, { id: '1.1', done: true, human: false },
    { id: '2', done: true, human: false },
  ], issues: [] });
});

test('新 comate 可省略 blocks，旧 blocks 仅作为兼容字段读取', () => {
  const withoutBlocks = valid.replace('- 被依赖 (blocks): [medal/page-integration]\n', '');
  assert.equal(parseComate(withoutBlocks).blocks, undefined);
  assert.deepEqual(parseComate(valid).blocks, ['medal/page-integration']);
});


test('v2 comate 将结构化完成证据下沉为机器门禁', () => {
  const complete = `# comate

- 格式版本 (format-version): 2
- 负责人 (owner): alice
- 状态 (status): done
- 验证模式 (validation-mode): hybrid
- 人工验证状态 (human-review): passed
- 依赖 (depends-on): []
- 交接 (handoff):
  - 已完成：实现与验证完成
  - 注释审计：已检查变更符号
  - 人工验证反馈：reviewer 于 2026-09-22 验证通过
  - 验证证据：npm test 通过
  - 安全与敏感信息结论：无敏感信息输出
  - 遗留风险与恢复条件：无
`;
  assert.deepEqual(validateComateRecord(parseComate(complete), { pendingTasks: 0 }), []);
  assert.doesNotMatch(complete, /生命周期结论/);

  const noHumanTasks = complete
    .replace('human-review): passed', 'human-review): not-required')
    .replace('  - 人工验证反馈：reviewer 于 2026-09-22 验证通过\n', '');
  assert.deepEqual(
    validateComateRecord(parseComate(noHumanTasks), { pendingTasks: 0, humanTasks: 0 }),
    []
  );
  assert.deepEqual(
    validateComateRecord({ ...parseComate(noHumanTasks), humanTaskResults: [['1.1', 'passed']] }, {
      pendingTasks: 0, humanTasks: 1, taskStates: [{ id: '1.1', done: true, human: true }],
    })
      .map(({ kind }) => kind),
    ['human-review-required']
  );

  const incomplete = complete.replace('  - 安全与敏感信息结论：无敏感信息输出\n', '  - 安全与敏感信息结论：\n');
  assert.deepEqual(
    validateComateRecord(parseComate(incomplete), { pendingTasks: 0 })
      .map(({ kind }) => kind),
    ['done-handoff-incomplete']
  );

  const deprecated = complete.replace('- 依赖 (depends-on): []\n', '- 依赖 (depends-on): []\n- 被依赖 (blocks): []\n');
  assert.equal(
    validateComateRecord(parseComate(deprecated), { pendingTasks: 0 })
      .some(({ kind }) => kind === 'deprecated-blocks-field'),
    true
  );
});
