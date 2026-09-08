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

test('任务进度只统计标准 checkbox', () => {
  assert.deepEqual(parseTaskProgress('- [x] 1.1 done\n- [X] 1.2 done\n- [ ] 1.3 pending\n- item\n'), {
    total: 3,
    complete: 2,
    pending: 1,
  });
});
