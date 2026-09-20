export const INDEX_FORMAT_VERSION = 1;
export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const CHUNK_STRATEGY_VERSION = 1;
export const INDEX_ROOT = '.falla/ui-knowledge/.index';
export const DEFAULT_TOP_K = 8;
export const MAX_TOP_K = 50;

export const INDEX_FILES = Object.freeze({
  manifest: 'manifest.json',
  chunks: 'chunks.jsonl',
  vectors: 'vectors.json',
});

export const INDEX_ACTIONS = Object.freeze([
  'build',
  'sync',
  'query',
  'status',
  'rebuild',
  'clear',
]);

export function createEmptyIndexManifest({
  provider = 'unconfigured',
  model = 'unconfigured',
  dimensions = null,
} = {}) {
  if (dimensions !== null && (!Number.isInteger(dimensions) || dimensions <= 0)) {
    throw new TypeError('dimensions must be null or a positive integer');
  }
  return {
    formatVersion: INDEX_FORMAT_VERSION,
    knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    chunkStrategyVersion: CHUNK_STRATEGY_VERSION,
    embedding: { provider, model, dimensions },
    documents: {},
  };
}

export function indexContractSummary() {
  return {
    formatVersion: INDEX_FORMAT_VERSION,
    knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    chunkStrategyVersion: CHUNK_STRATEGY_VERSION,
    indexPath: INDEX_ROOT,
    files: INDEX_FILES,
    actions: INDEX_ACTIONS,
    defaultTopK: DEFAULT_TOP_K,
    maxTopK: MAX_TOP_K,
  };
}
