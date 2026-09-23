import assert from 'node:assert/strict';
import test from 'node:test';

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
  const human = valid.replace(
    '- 状态 (status): in-progress',
    `- 状态 (status): in-progress
- 验证模式 (validation-mode): human
- 人工验证状态 (human-review): pending`
  );
  assert.deepEqual(parseComate(human), {
    validationMode: 'human',
    humanReview: 'pending',
    owner: 'alice',
    status: 'in-progress',
    dependsOn: ['medal/view-model'],
    blocks: ['medal/page-integration'],
    handoff: '已完成数据绑定，待视觉校准',
  });
  assert.deepEqual(
    validateComateRecord({ ...parseComate(human), status: 'done' }, { pendingTasks: 0 })
      .map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', validationMode: 'hybrid', humanReview: 'pending',
    }, { pendingTasks: 0, humanTasks: 1 }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', validationMode: 'hybrid', humanReview: 'not-required',
    }, { pendingTasks: 0, humanTasks: 1 }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({
      ...parseComate(human), status: 'done', humanReview: 'passed',
    }, { pendingTasks: 0 }),
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
    validateComateRecord(record, { pendingTasks: 0, humanTasks: 1 }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord(record, { pendingTasks: 0 }).map(({ kind }) => kind),
    ['human-review-required']
  );
  assert.deepEqual(
    validateComateRecord({ ...record, validationMode: 'human' }, {
      pendingTasks: 0, humanTasks: 0,
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
  });
  assert.equal(parseTaskProgress('- [x] 1.1 implement\n- [x] 2.1 [人工] verify\n').humanTasks, 1);
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
  - 生命周期结论：无泄漏和销毁后更新
  - 安全与敏感信息结论：无敏感信息输出
  - 遗留风险与恢复条件：无
`;
  assert.deepEqual(validateComateRecord(parseComate(complete), { pendingTasks: 0 }), []);

  const noHumanTasks = complete
    .replace('human-review): passed', 'human-review): not-required')
    .replace('  - 人工验证反馈：reviewer 于 2026-09-22 验证通过\n', '');
  assert.deepEqual(
    validateComateRecord(parseComate(noHumanTasks), { pendingTasks: 0, humanTasks: 0 }),
    []
  );
  assert.deepEqual(
    validateComateRecord(parseComate(noHumanTasks), { pendingTasks: 0, humanTasks: 1 })
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
