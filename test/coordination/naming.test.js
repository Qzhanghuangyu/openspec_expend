import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLogicalReference,
  toPhysicalName,
} from '../../src/coordination/naming.js';

test('逻辑父子名映射为带固定 child 字面量的物理名', () => {
  assert.equal(toPhysicalName('medal', 'detail', new Set()), 'medal-child-detail');
  assert.deepEqual(parseLogicalReference('medal/view-model'), {
    logical: 'medal/view-model',
    parent: 'medal',
    child: 'view-model',
  });
  assert.deepEqual(parseLogicalReference('0001-medal/02-detail'), {
    logical: '0001-medal/02-detail',
    parent: '0001-medal',
    child: '02-detail',
  });
});

test('物理名冲突时追加逻辑引用 SHA-256 前八位', () => {
  assert.equal(
    toPhysicalName('medal', 'detail', new Set(['medal-child-detail'])),
    'medal-child-detail-d68471dc'
  );
});

test('拒绝三层引用和非 kebab-case 名称', () => {
  for (const reference of ['medal/view/detail', 'Medal/detail', 'medal/list_card']) {
    assert.throws(
      () => parseLogicalReference(reference),
      (error) => error.code === 1 && error.message.includes('parent/child')
    );
  }
});
