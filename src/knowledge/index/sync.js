import { withProjectLock } from '../../locks.js';
import { knowledgeError } from '../files.js';
import { createEmptyIndexManifest, INDEX_ROOT } from './contract.js';
import { readIndexConfig } from './config.js';
import { loadIndexableKnowledge } from './documents.js';
import { createEmbeddingProvider } from './providers/provider.js';
import { readIndexSnapshot, replaceIndex } from './store.js';

function compatible(snapshot, provider) {
  const embedding = snapshot.manifest.embedding;
  return embedding.provider === provider.id
    && embedding.model === provider.model
    && embedding.dimensions === provider.dimensions;
}

function documentRecord(document) {
  return {
    path: document.path,
    kind: document.kind,
    status: document.status,
    reuse: document.reuse,
    contentHash: document.contentHash,
    chunkIds: document.chunks.map(chunk => chunk.chunkId),
  };
}

function sortChunks(chunks) {
  return [...chunks].sort((left, right) => left.documentId.localeCompare(right.documentId)
    || left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId));
}

export async function syncKnowledgeIndex(rootInput, { now = () => new Date() } = {}) {
  return withProjectLock(rootInput, 'knowledge-index', async () => {
    const snapshot = await readIndexSnapshot(rootInput);
    if (!snapshot) throw knowledgeError('index-not-found');
    const configResult = await readIndexConfig(rootInput);
    const provider = createEmbeddingProvider(configResult.config.semantic);
    if (!compatible(snapshot, provider)) throw knowledgeError('index-rebuild-required');

    const loaded = await loadIndexableKnowledge(rootInput);
    const previous = snapshot.manifest.documents;
    const current = new Map(loaded.documents.map(document => [document.id, document]));
    const added = [];
    const updated = [];
    const removed = [];
    const unchanged = [];

    for (const document of loaded.documents) {
      const old = previous[document.id];
      if (!old) added.push(document.id);
      else if (old.contentHash !== document.contentHash
        || old.path !== document.path
        || old.status !== document.status
        || old.reuse !== document.reuse) updated.push(document.id);
      else unchanged.push(document.id);
    }
    for (const id of Object.keys(previous)) {
      if (!current.has(id)) removed.push(id);
    }

    const changedIds = new Set([...added, ...updated]);
    const keptIds = new Set(unchanged);
    const changedChunks = loaded.documents
      .filter(document => changedIds.has(document.id))
      .flatMap(document => document.chunks);
    const embeddings = await provider.embed(changedChunks.map(chunk => chunk.text));
    if (embeddings.length !== changedChunks.length
      || embeddings.some(vector => !Array.isArray(vector)
        || vector.length !== provider.dimensions
        || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
      throw knowledgeError('invalid-embedding-result');
    }

    const oldChunks = snapshot.chunks.filter(chunk => keptIds.has(chunk.documentId));
    const oldVectorMap = new Map(snapshot.vectors.vectors.map(vector => [vector.chunkId, vector.values]));
    const chunks = sortChunks([...oldChunks, ...changedChunks]);
    const changedVectorMap = new Map(changedChunks.map((chunk, index) => [chunk.chunkId, embeddings[index]]));
    const vectors = {
      formatVersion: snapshot.manifest.formatVersion,
      dimensions: provider.dimensions,
      vectors: chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        values: changedVectorMap.get(chunk.chunkId) ?? oldVectorMap.get(chunk.chunkId),
      })),
    };

    const documents = {};
    for (const document of loaded.documents) documents[document.id] = documentRecord(document);
    const rejected = loaded.validation.entries.filter(entry => entry.reuse === 'rejected').length;
    const hasChanges = added.length > 0 || updated.length > 0 || removed.length > 0
      || rejected !== snapshot.manifest.counts.rejected;
    if (hasChanges) {
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
      await replaceIndex(rootInput, { manifest, chunks, vectors });
    }

    return {
      ok: true,
      action: 'sync',
      indexPath: INDEX_ROOT,
      changed: hasChanges,
      added,
      updated,
      removed,
      unchanged,
      embeddedChunks: changedChunks.length,
      documents: loaded.documents.length,
      chunks: chunks.length,
      rejected,
    };
  });
}
