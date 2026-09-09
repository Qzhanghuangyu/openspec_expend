import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedVersion,
  parseOpenSpecVersion,
  SUPPORTED_OPENSPEC_RANGE,
} from '../../src/openspec/version.js';

test('解析 OpenSpec 三段式版本', () => {
  assert.deepEqual(parseOpenSpecVersion('1.12.0\n'), {
    major: 1,
    minor: 12,
    patch: 0,
    raw: '1.12.0',
  });
});

test('拒绝格式异常的 OpenSpec 版本', () => {
  assert.throws(
    () => parseOpenSpecVersion('openspec-dev'),
    (error) => error.code === 2 && error.message.includes('无法识别')
  );
});

test('升级后只接受已验证的 OpenSpec 1.12.x', () => {
  assert.equal(SUPPORTED_OPENSPEC_RANGE, '>=1.12.0 <1.13.0');
  assert.equal(assertSupportedVersion('1.12.9').raw, '1.12.9');
  assert.throws(
    () => assertSupportedVersion('1.11.9'),
    (error) => error.code === 2 && error.message.includes(SUPPORTED_OPENSPEC_RANGE)
  );
  assert.throws(
    () => assertSupportedVersion('1.13.0'),
    (error) => error.code === 2 && error.message.includes(SUPPORTED_OPENSPEC_RANGE)
  );
});
