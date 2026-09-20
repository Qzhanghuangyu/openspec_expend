import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCAL_KEYWORD_DIMENSIONS,
  LOCAL_KEYWORD_MODEL,
  defaultIndexConfig,
  validateIndexConfig,
} from '../../src/knowledge/index/config.js';
import { LocalKeywordEmbeddingProvider } from '../../src/knowledge/index/providers/local-keyword.js';
import { createEmbeddingProvider } from '../../src/knowledge/index/providers/provider.js';

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

test('local-keyword 配置使用固定模型和安全默认维度', () => {
  const config = defaultIndexConfig();
  config.semantic = {
    ...config.semantic,
    provider: 'local-keyword',
    model: LOCAL_KEYWORD_MODEL,
    dimensions: DEFAULT_LOCAL_KEYWORD_DIMENSIONS,
  };
  const normalized = validateIndexConfig(config);
  assert.equal(normalized.semantic.provider, 'local-keyword');
  assert.equal(normalized.semantic.dimensions, 512);
  assert.ok(createEmbeddingProvider(normalized.semantic) instanceof LocalKeywordEmbeddingProvider);
});

test('local-keyword 对中文词组和 MP4 token 产生可解释相似度', async () => {
  const provider = new LocalKeywordEmbeddingProvider();
  const [query, anim, unrelated] = await provider.embed([
    '播放MP4',
    '播放本地 VAP MP4 动画',
    'RecyclerView 分页列表和空状态',
  ]);
  assert.ok(cosine(query, anim) > cosine(query, unrelated));
  assert.ok(cosine(query, anim) > 0);
});

test('local-keyword 不访问网络且相同文本结果稳定', async () => {
  const provider = new LocalKeywordEmbeddingProvider({ dimensions: 128 });
  const first = await provider.embed(['用户等级图片扫光']);
  const second = await provider.embed(['用户等级图片扫光']);
  assert.deepEqual(first, second);
  assert.equal(provider.calls, 2);
});

test('local-keyword 支持英文分隔形式和轻微拼写差异', async () => {
  const provider = new LocalKeywordEmbeddingProvider({ dimensions: 512 });
  const [query, separated, compact, unrelated] = await provider.embed([
    'SVGA image view animtion',
    'svga-image-view animation',
    'SVGAImageView animation',
    'RecyclerView pagination',
  ]);
  assert.ok(cosine(query, separated) > cosine(query, unrelated));
  assert.ok(cosine(query, compact) > cosine(query, unrelated));
});
