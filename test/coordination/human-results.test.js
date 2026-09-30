import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComate, parseTaskProgress, validateComateRecord } from '../../src/coordination/comate.js';

const mixed = `<!-- falla-tasks-format: 1 -->
## 1. 验收
- [x] 1.1 [人工] 页面确认（依赖：无）
- [ ] 1.2 后续交付（依赖：1.1）
- [ ] 1.3 [人工] 第二页面确认（依赖：无）
- [ ] 1.4 第二页面交付（依赖：1.3）
`;

function comate(results = undefined, options = {}) {
  return `# comate
- 格式版本 (format-version): 2
- 执行模式 (execution-mode): single
- 负责人 (owner): alice
- 状态 (status): ${options.status ?? 'in-progress'}
- 验证模式 (validation-mode): ${options.mode ?? 'hybrid'}
- 人工验证状态 (human-review): ${options.review ?? 'pending'}
${results === undefined ? '' : `- 人工任务结果 (human-task-results): ${JSON.stringify(results)}\n`}- 依赖 (depends-on): []
- 交接 (handoff):
  - 已完成：当前合法进度
  - 注释审计：无业务代码修改
  - 人工验证反馈：
  - 验证证据：现有定向验证
  - 安全与敏感信息结论：不输出正文
  - 遗留风险与恢复条件：按验收结果恢复
`;
}

function validate(markdown, tasks = mixed) {
  const progress = parseTaskProgress(tasks);
  return validateComateRecord(parseComate(markdown), {
    pendingTasks: progress.pending, humanTasks: progress.humanTasks,
    taskIssues: progress.issues, taskStates: progress.taskStates,
  });
}

test('已勾选人工 task 缺少逐项通过结果时，in-progress 即拒绝，不等 change done', () => {
  const issues = validate(comate());
  assert.ok(issues.some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
});

test('pending 或 failed 不能支撑人工 task 的完成 checkbox', () => {
  for (const result of ['pending', 'failed']) {
    assert.ok(validate(comate([['1.1', result]])).some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
  }
});

test('合法部分人工验收只需任务编号和 passed，总 pending 与空反馈均不阻断已通过项', () => {
  assert.deepEqual(validate(comate([['1.1', 'passed'], ['1.3', 'pending']])), []);
  const next = mixed.replace('[ ] 1.2', '[x] 1.2');
  assert.deepEqual(validate(comate([['1.1', 'passed'], ['1.3', 'pending']]), next), []);
});

test('其他任务的通过结果不能替代本任务，错误关联只输出规范编号', () => {
  assert.ok(validate(comate([['1.3', 'passed']])).some(issue => issue.task === '1.1' && issue.kind === 'human-task-result-required'));
  const unknown = validate(comate([['9.9', 'passed']]));
  assert.ok(unknown.some(issue => issue.kind === 'human-task-result-unknown' && issue.task === '9.9'));
});

test('结果字段拒绝重复任务、无效状态、额外材料及重复字段，不回显原始值', () => {
  const invalid = [
    [['1.1', 'passed'], ['1.1', 'failed']],
    [['PRIVATE_ID', 'passed']],
    [['1.1', 'PRIVATE_RESULT']],
    [['1.1', 'passed', 'PRIVATE_EVIDENCE']],
    { '1.1': 'passed' },
  ];
  for (const results of invalid) {
    assert.throws(() => parseComate(comate(results)), error => error.code === 1 && !/PRIVATE_/.test(error.message));
  }
  const duplicated = comate([['1.1', 'passed']]).replace('- 依赖 (depends-on): []', '- 人工任务结果 (human-task-results): []\n- 依赖 (depends-on): []');
  assert.throws(() => parseComate(duplicated), error => error.code === 1);
});

test('任务续行及嵌套人工标记绑定稳定编号，不能用父编号冒充子结果', () => {
  const tasks = '- [x] 1 外层\n  - [x] 1.1 内层\n    ### 验收\n    [人工] 内层确认\n';
  assert.ok(validate(comate([['1', 'passed']]), tasks).some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
  assert.deepEqual(validate(comate([['1.1', 'passed']]), tasks), []);
});

test('旧未编号人工 task 已勾选时必须显式关联编号，不用总 passed 追认', () => {
  const issues = validate(comate([], { review: 'passed' }), '- [x] [人工] 旧页面验收\n');
  assert.ok(issues.some(issue => issue.kind === 'human-task-id-required'));
});

test('human 模式的任务均由人工结果确认；通过只需结果，不要求反馈证据', () => {
  const tasks = '- [x] 1.1 人工模式验收\n';
  assert.ok(validate(comate([], { mode: 'human', review: 'passed', status: 'done' }), tasks)
    .some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
  assert.deepEqual(validate(comate([['1.1', 'passed']], { mode: 'human', review: 'passed', status: 'done' }), tasks), []);
});


test('逐项人工结果只有 passed 才可支撑勾选，普通任务不能被记为人工结果', () => {
  const tasks = '- [x] 1.1 普通实施\n';
  assert.ok(validate(comate([['1.1', 'passed']]), tasks).some(issue => issue.kind === 'human-task-result-not-human'));
});

test('总 passed 和笼统人工反馈不能代替逐项结果；缺任务上下文也不能误判通过', () => {
  const text = comate(undefined, { review: 'passed' }).replace('  - 人工验证反馈：', '  - 人工验证反馈：笼统确认通过');
  assert.ok(validate(text).some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
  assert.ok(validateComateRecord(parseComate(comate([['1.1', 'passed']])), {
    pendingTasks: 0, humanTasks: 1,
  }).some(issue => issue.kind === 'human-task-state-required'));
});

test('存在人工结果但调用方缺任务上下文时也不能报告一致，不能靠省略计数绕过', () => {
  const record = parseComate(comate([['1.1', 'passed']]));
  assert.ok(validateComateRecord(record, { pendingTasks: 0 })
    .some(issue => issue.kind === 'human-task-state-required'));
});

test('结果数组与任务预算一致，超限或空结果值失败且诊断不含原始输入', () => {
  const entries = Array.from({ length: 2048 }, (_, index) => [`T${index + 1}`, 'pending']);
  assert.equal(parseComate(comate(entries)).humanTaskResults.length, 2048);
  for (const raw of [JSON.stringify([...entries, ['T2049', 'passed']]), '', 'null', 'PRIVATE_NOT_JSON']) {
    const text = comate([]).replace('human-task-results): []', `human-task-results): ${raw}`);
    assert.throws(() => parseComate(text), error => error.code === 1 && !error.message.includes('PRIVATE_'));
  }
});

test('旧围栏 checkbox 的人工续行仍归本项，无结果不能以 not-required 放行', () => {
  const tasks = '```md\n- [x] 1.1 页面验收\n  [人工] 本项必须人工确认\n```\n';
  const progress = parseTaskProgress(tasks);
  assert.deepEqual(progress.taskStates, [{ id: '1.1', done: true, human: true }]);
  const issues = validate(comate([], { status: 'done', review: 'not-required' }), tasks);
  assert.ok(issues.some(issue => issue.kind === 'human-task-result-required' && issue.task === '1.1'));
  assert.ok(issues.some(issue => issue.kind === 'human-review-required'));
});

test('旧围栏人工 checkbox 保留已有显式编号，补本项 passed 即可恢复', () => {
  const tasks = '```md\n- [x] 1.1 [人工] 旧页面验收\n```\n';
  assert.deepEqual(parseTaskProgress(tasks).taskStates, [{ id: '1.1', done: true, human: true }]);
  assert.deepEqual(validate(comate([['1.1', 'passed']], { status: 'done', review: 'passed' }), tasks), []);
});

test('嵌套代码示例人工标记不污染外层普通任务，未勾选示例不索要通过结果', () => {
  const tasks = '- [x] 1.1 普通自动检查\n  ```md\n  - [ ] 1.2 [人工] 仅作示例\n  ```\n';
  const progress = parseTaskProgress(tasks);
  assert.equal(progress.total, 2);
  assert.equal(progress.humanTasks, 1);
  assert.deepEqual(progress.taskStates, [
    { id: '1.1', done: true, human: false },
    { id: '1.2', done: false, human: true },
  ]);
  assert.deepEqual(validate(comate([], { review: 'pending' }), tasks), []);
});

test('旧围栏与正文人工任务同编号时拒绝歧义，不让一个 passed 支撑两项验收', () => {
  const tasks = '- [x] 1.1 [人工] 第一页面\n\n```md\n- [x] 1.1 [人工] 第二页面\n```\n';
  assert.deepEqual(parseTaskProgress(tasks).issues, []);
  const issues = validate(comate([['1.1', 'passed']]), tasks);
  assert.ok(issues.some(issue => issue.kind === 'human-task-id-ambiguous' && issue.task === '1.1'));
});

test('人工编号与普通围栏示例重复时拒绝歧义，不由 Map 顺序覆盖人工属性', () => {
  const tasks = '- [x] 1.1 [人工] 第一页面\n\n```md\n- [ ] 1.1 普通示例\n```\n';
  const issues = validate(comate([['1.1', 'passed']]), tasks);
  assert.ok(issues.some(issue => issue.kind === 'human-task-id-ambiguous' && issue.task === '1.1'));
  assert.equal(issues.some(issue => issue.kind === 'human-task-result-not-human'), false);
  const ordinary = tasks.replace('[人工] 第一页面', '普通实现');
  assert.deepEqual(validate(comate([]), ordinary), []);
});
