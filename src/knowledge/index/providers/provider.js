import { FallaError } from '../../../errors.js';
import { FakeEmbeddingProvider } from './fake.js';
import { LocalKeywordEmbeddingProvider } from './local-keyword.js';

export function createEmbeddingProvider(semanticConfig) {
  if (semanticConfig?.provider === 'fake') {
    return new FakeEmbeddingProvider({
      model: semanticConfig.model,
      dimensions: semanticConfig.dimensions,
    });
  }
  if (semanticConfig?.provider === 'local-keyword') {
    return new LocalKeywordEmbeddingProvider({
      model: semanticConfig.model,
      dimensions: semanticConfig.dimensions,
    });
  }
  throw new FallaError(1, 'UI 知识索引尚未配置可用的 Embedding Provider');
}
