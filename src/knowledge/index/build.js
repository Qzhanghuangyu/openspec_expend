import { withProjectLock } from '../../locks.js';
import { knowledgeError } from '../files.js';
import {
  createEmptyIndexManifest,
  INDEX_ROOT,
} from './contract.js';
import { readIndexConfig } from './config.js';
import { loadIndexableKnowledge } from './documents.js';
import { createEmbeddingProvider } from './providers/provider.js';
import {
  readIndexManifest,
  removeIndex,
  replaceIndex,
  writeNewIndex,
} from './store.js';

function assertVectors(vectors, count, dimensions) {
  if (!Array.isArray(vectors) || vectors.length !== count) throw knowledgeError('invalid-embedding-result');
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions
      || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw knowledgeError('invalid-embedding-result');
    }
  }
}

async function prepareFullIndex(root, now) {
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
  const vectors = {
    formatVersion: manifest.formatVersion,
    dimensions: provider.dimensions,
    vectors: chunks.map((chunk, index) => ({ chunkId: chunk.chunkId, values: embeddings[index] })),
  };
  return {
    payload: { manifest, chunks, vectors },
    summary: {
      provider: provider.id,
      model: provider.model,
      dimensions: provider.dimensions,
      documents: manifest.counts.documents,
      chunks: manifest.counts.chunks,
      rejected: manifest.counts.rejected,
    },
  };
}

export async function buildKnowledgeIndex(root, { now = () => new Date() } = {}) {
  return withProjectLock(root, 'knowledge-index', async () => {
    const prepared = await prepareFullIndex(root, now);
    await writeNewIndex(root, prepared.payload);
    return { ok: true, action: 'build', indexPath: INDEX_ROOT, ...prepared.summary };
  });
}

export async function rebuildKnowledgeIndex(root, { now = () => new Date() } = {}) {
  return withProjectLock(root, 'knowledge-index', async () => {
    const prepared = await prepareFullIndex(root, now);
    const exists = Boolean(await readIndexManifest(root));
    if (exists) await replaceIndex(root, prepared.payload);
    else await writeNewIndex(root, prepared.payload);
    return {
      ok: true,
      action: 'rebuild',
      indexPath: INDEX_ROOT,
      replaced: exists,
      ...prepared.summary,
    };
  });
}

export async function clearKnowledgeIndex(root) {
  return withProjectLock(root, 'knowledge-index', async () => ({
    ok: true,
    action: 'clear',
    indexPath: INDEX_ROOT,
    removed: await removeIndex(root),
  }));
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
