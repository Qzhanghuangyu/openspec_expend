import {
  createEmptyIndexManifest,
  INDEX_ROOT,
} from './contract.js';
import { readIndexConfig } from './config.js';
import { loadIndexableKnowledge } from './documents.js';
import { createEmbeddingProvider } from './providers/provider.js';
import {
  readIndexManifest,
  writeNewIndex,
} from './store.js';
import { knowledgeError } from '../files.js';

function assertVectors(vectors, count, dimensions) {
  if (!Array.isArray(vectors) || vectors.length !== count) throw knowledgeError('invalid-embedding-result');
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions
      || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw knowledgeError('invalid-embedding-result');
    }
  }
}

export async function buildKnowledgeIndex(root, { now = () => new Date() } = {}) {
  const configResult = await readIndexConfig(root);
  const provider = createEmbeddingProvider(configResult.config.semantic);
  const loaded = await loadIndexableKnowledge(root);
  const chunks = loaded.documents.flatMap(document => document.chunks);
  const embeddings = await provider.embed(chunks.map(chunk => chunk.text));
  assertVectors(embeddings, chunks.length, provider.dimensions);

  const documents = {};
  for (const document of loaded.documents) {
    documents[document.id] = {
      path: document.path,
      kind: document.kind,
      status: document.status,
      reuse: document.reuse,
      contentHash: document.contentHash,
      chunkIds: document.chunks.map(chunk => chunk.chunkId),
    };
  }
  const rejected = loaded.validation.entries.filter(entry => entry.reuse === 'rejected').length;
  const manifest = {
    ...createEmptyIndexManifest({
      provider: provider.id,
      model: provider.model,
      dimensions: provider.dimensions,
    }),
    generatedAt: now().toISOString(),
    counts: { documents: loaded.documents.length, chunks: chunks.length, rejected },
    documents,
  };
  const vectorStore = {
    formatVersion: manifest.formatVersion,
    dimensions: provider.dimensions,
    vectors: chunks.map((chunk, index) => ({ chunkId: chunk.chunkId, values: embeddings[index] })),
  };
  await writeNewIndex(root, { manifest, chunks, vectors: vectorStore });
  return {
    ok: true,
    action: 'build',
    indexPath: INDEX_ROOT,
    provider: provider.id,
    model: provider.model,
    dimensions: provider.dimensions,
    documents: manifest.counts.documents,
    chunks: manifest.counts.chunks,
    rejected: manifest.counts.rejected,
  };
}

export async function statusKnowledgeIndex(root) {
  const manifest = await readIndexManifest(root);
  if (!manifest) return { ok: true, action: 'status', exists: false, indexPath: INDEX_ROOT };
  return {
    ok: true,
    action: 'status',
    exists: true,
    indexPath: INDEX_ROOT,
    formatVersion: manifest.formatVersion,
    generatedAt: manifest.generatedAt,
    provider: manifest.embedding.provider,
    model: manifest.embedding.model,
    dimensions: manifest.embedding.dimensions,
    ...manifest.counts,
  };
}
