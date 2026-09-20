import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import {
  DEFAULT_FAKE_DIMENSIONS,
  INDEX_CONFIG_PATH,
  defaultIndexConfig,
  readIndexConfig,
  validateIndexConfig,
} from '../../src/knowledge/index/config.js';
import { createEmbeddingProvider } from '../../src/knowledge/index/providers/provider.js';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/falla-index-config-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'openspec'));
  await mkdir(path.join(root, path.dirname(INDEX_CONFIG_PATH)), { recursive: true });
  return root;
}

function fakeConfig(overrides = {}) {
  const base = defaultIndexConfig();
  return {
    ...base,
    semantic: {
      ...base.semantic,
      provider: 'fake',
      model: 'fake-v1',
      dimensions: DEFAULT_FAKE_DIMENSIONS,
      ...overrides,
    },
  };
}

test('缺少 config.yaml 时返回只读安全默认值且不创建文件', async (t) => {
  const root = await fixture(t);
  const result = await readIndexConfig(root);
  assert.equal(result.source, 'default');
  assert.deepEqual(result.config, defaultIndexConfig());
});

test('读取固定项目配置并规范化 Fake Provider', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, INDEX_CONFIG_PATH), YAML.stringify(fakeConfig({ topK: 5 })));
  const result = await readIndexConfig(root);
  assert.equal(result.source, 'project');
  assert.equal(result.config.semantic.provider, 'fake');
  assert.equal(result.config.semantic.dimensions, 32);
  assert.equal(result.config.semantic.topK, 5);
});

test('拒绝越界索引路径、未知 Provider、非法维度和放宽项目隔离', () => {
  assert.throws(() => validateIndexConfig(fakeConfig({ indexPath: '../outside' })));
  assert.throws(() => validateIndexConfig(fakeConfig({ provider: 'shell-command' })));
  assert.throws(() => validateIndexConfig(fakeConfig({ dimensions: 0 })));
  const config = fakeConfig();
  config.retrieval.projectOnly = false;
  assert.throws(() => validateIndexConfig(config));
});

test('拒绝含凭据和符号链接的配置且不回显敏感值', async (t) => {
  const root = await fixture(t);
  const config = path.join(root, INDEX_CONFIG_PATH);
  await writeFile(config, 'apiKey: PRIVATE_CONFIG_MARKER\n');
  await assert.rejects(readIndexConfig(root), error => {
    assert.doesNotMatch(error.message, /PRIVATE_CONFIG_MARKER/);
    return error.details?.kind === 'sensitive-index-config';
  });
  await rm(config);
  const outside = path.join(root, 'outside.yaml');
  await writeFile(outside, YAML.stringify(fakeConfig()));
  await symlink(outside, config);
  await assert.rejects(readIndexConfig(root));
});

test('Fake Provider 输出确定、定长、归一化向量并统计调用量', async () => {
  const provider = createEmbeddingProvider(fakeConfig().semantic);
  const first = await provider.embed(['H5 动画', 'H5 动画']);
  const second = await provider.embed(['等级扫光']);
  assert.deepEqual(first[0], first[1]);
  assert.notDeepEqual(first[0], second[0]);
  assert.equal(first[0].length, DEFAULT_FAKE_DIMENSIONS);
  assert.ok(Math.abs(Math.sqrt(first[0].reduce((sum, value) => sum + value * value, 0)) - 1) < 1e-12);
  assert.equal(provider.calls, 3);
});

test('未配置 Provider 时明确拒绝，不尝试网络或动态模块', () => {
  assert.throws(
    () => createEmbeddingProvider(defaultIndexConfig().semantic),
    /尚未配置可用的 Embedding Provider/
  );
});
